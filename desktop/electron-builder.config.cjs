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
 */
const withCuda = process.env.JBL_CUDA === "1";

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
    "!node_modules/node-llama-cpp/llama/**",
    "!node_modules/node-llama-cpp/templates/**",
  ],
  extraResources: [
    { from: "../out", to: "site", filter: ["**/*"] },
    { from: "../docs/virality-playbook.md", to: "playbook/virality-playbook.md" },
  ],
  asar: true,
  asarUnpack: ["node_modules/ffmpeg-static/**", "node_modules/node-llama-cpp/bins/**", "node_modules/@node-llama-cpp/**"],
  electronLanguages: ["en-US", "pl", "es"],
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "portable", arch: ["x64"] },
    ],
    icon: "../public/icons/icon-512.png",
    signtoolOptions: { publisherName: "JumpingBallsLive" },
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
