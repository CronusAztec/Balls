/**
 * --- desktop-exe --- electron-builder configuration of the Windows app.
 *
 * Targets: an NSIS installer (per user, no admin rights) and a portable EXE, x64:
 *   JumpingBallsLive-Setup-<version>.exe and JumpingBallsLive-<version>-portable.exe
 * The site's static export (../out, built with an empty base path by `npm run site`) and the virality playbook go into the
 * app's resources. node-llama-cpp's native binaries and ffmpeg are unpacked from the asar archive (native code and
 * executables cannot run from inside it).
 *
 * The llama.cpp GPU builds: the Vulkan build (NVIDIA, AMD and Intel GPUs with a current driver) and the CPU build are always
 * packed. The CUDA builds are large (CUDA runtime ~370 MB) and left out unless JBL_CUDA=1 is set when packaging; without
 * them NVIDIA GPUs run the model through Vulkan.
 *
 * Code signing: unsigned unless WIN_CSC_LINK (base64 .pfx or a path/URL) and WIN_CSC_KEY_PASSWORD are set – electron-builder
 * reads them from the environment (see .github/workflows/desktop.yml). Unsigned builds trigger SmartScreen
 * ("More info" → "Run anyway").
 *
 * --- desktop-ai-fix --- `signtoolOptions.publisherName` only with a certificate: electron-builder writes it into the app's
 * app-update.yml, and electron-updater then refuses every update that is not signed by that publisher
 * (ERR_UPDATER_INVALID_SIGNATURE). 1.0.2 shipped it unsigned with the name set, so it cannot update itself to an unsigned
 * 1.0.3 (its users install 1.0.3 by hand once); from 1.0.3 on, unsigned builds carry no publisher name and update each other.
 */
const withCuda = process.env.JBL_CUDA === "1";
/** --- desktop-ai-fix --- A code-signing certificate is configured (the workflow sets WIN_CSC_LINK only when the secret exists). */
const signed = !!process.env.WIN_CSC_LINK;

module.exports = {
  appId: "com.jumpingballslive.desktop",
  productName: "JumpingBallsLive",
  copyright: "© JumpingBallsLive",
  directories: { output: "release", buildResources: "build" },
  files: [
    "dist/**/*",
    "package.json",
    "!**/*.map",
    "!node_modules/@node-llama-cpp/*-arm64/**",
    "!node_modules/@node-llama-cpp/*-armv7l/**",
    "!node_modules/@node-llama-cpp/*-riscv64/**",
    "!node_modules/@node-llama-cpp/mac-*/**",
    ...(withCuda ? [] : ["!node_modules/@node-llama-cpp/*-cuda/**", "!node_modules/@node-llama-cpp/*-cuda-ext/**"]),
    // node-llama-cpp reads llama/binariesGithubRelease.json (a top-level await of its index) and llama.cpp.info.json, and
    // builds grammars from llama/grammars: those small files must ship, or `import("node-llama-cpp")` throws while the
    // module loads and the local AI cannot start. Only the heavy source-build parts of llama/ are left out.
    "!node_modules/node-llama-cpp/llama/llama.cpp/**",
    "!node_modules/node-llama-cpp/llama/gitRelease.bundle",
    "!node_modules/node-llama-cpp/llama/localBuilds/**",
    "!node_modules/node-llama-cpp/llama/xpack/**",
    "!node_modules/node-llama-cpp/templates/**",
  ],
  extraResources: [
    { from: "../out", to: "site", filter: ["**/*"] },
    { from: "../docs/virality-playbook.md", to: "playbook/virality-playbook.md" },
  ],
  asar: true,
  // node-llama-cpp's llama/ files are unpacked too: it checks its grammars folder with fs.access, which Electron's asar
  // support answers ENOENT for a directory inside the archive (getGrammarFor("json") would fail in the package only).
  asarUnpack: ["node_modules/ffmpeg-static/**", "node_modules/node-llama-cpp/bins/**", "node_modules/node-llama-cpp/llama/**", "node_modules/@node-llama-cpp/**"],
  electronLanguages: ["en-US", "pl", "es"],
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "portable", arch: ["x64"] },
    ],
    icon: "../public/icons/icon-512.png",
    ...(signed ? { signtoolOptions: { publisherName: "JumpingBallsLive" } } : {}), // --- desktop-ai-fix --- (see above)
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "JumpingBallsLive",
    artifactName: "JumpingBallsLive-Setup-${version}.${ext}",
  },
  portable: { artifactName: "JumpingBallsLive-${version}-portable.${ext}" },
  linux: { target: ["dir"], icon: "../public/icons/icon-512.png", category: "Video" },
  publish: [{ provider: "github", owner: "CronusAztec", repo: "Balls", releaseType: "release" }],
};
