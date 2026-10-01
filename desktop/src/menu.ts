import type { MenuAction } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- The application menu as data (main.ts turns it into an Electron Menu; tests check the shortcuts are
 * unique). Simulator and studio entries send a `desktop:menu` action to the page, which does what the matching button
 * does; the rest are handled by the main process.
 */

export type MenuCommand = { action: MenuAction } | { command: "output-folder" | "open-logs" | "check-updates" | "website" | "download-page" | "releases" | "about" | "reload" | "devtools" | "quit" } | { role: "togglefullscreen" | "zoomIn" | "zoomOut" | "resetZoom" | "copy" | "paste" | "cut" | "selectAll" | "undo" | "redo" };

export interface MenuEntry {
  id: string;
  accelerator?: string;
  run: MenuCommand;
}

export interface MenuGroup {
  id: string;
  entries: (MenuEntry | "separator")[];
}

export const MENU: readonly MenuGroup[] = [
  {
    id: "file",
    entries: [
      { id: "openSong", accelerator: "CmdOrCtrl+O", run: { action: "open-song" } },
      { id: "openVideo", accelerator: "CmdOrCtrl+Shift+O", run: { action: "open-video" } },
      { id: "openProject", accelerator: "CmdOrCtrl+Alt+O", run: { action: "open-project" } },
      { id: "outputFolder", run: { command: "output-folder" } },
      "separator",
      { id: "quit", accelerator: "CmdOrCtrl+Q", run: { command: "quit" } },
    ],
  },
  {
    id: "edit",
    entries: [
      { id: "undo", run: { role: "undo" } },
      { id: "redo", run: { role: "redo" } },
      "separator",
      { id: "cut", run: { role: "cut" } },
      { id: "copy", run: { role: "copy" } },
      { id: "paste", run: { role: "paste" } },
      { id: "selectAll", run: { role: "selectAll" } },
    ],
  },
  {
    id: "simulator",
    entries: [
      { id: "start", accelerator: "CmdOrCtrl+Enter", run: { action: "start" } },
      { id: "restart", accelerator: "CmdOrCtrl+Shift+Enter", run: { action: "restart" } },
      { id: "find", accelerator: "CmdOrCtrl+F", run: { action: "find" } },
      "separator",
      { id: "fastExport", accelerator: "CmdOrCtrl+E", run: { action: "fast-export" } },
      { id: "record", accelerator: "CmdOrCtrl+Shift+E", run: { action: "record" } },
    ],
  },
  {
    id: "studio",
    entries: [
      { id: "gpu", accelerator: "CmdOrCtrl+1", run: { action: "gpu" } },
      { id: "queue", accelerator: "CmdOrCtrl+2", run: { action: "queue" } },
      { id: "ai", accelerator: "CmdOrCtrl+3", run: { action: "ai" } },
      { id: "library", accelerator: "CmdOrCtrl+4", run: { action: "library" } },
    ],
  },
  {
    id: "view",
    entries: [
      { id: "fullscreen", accelerator: "F11", run: { role: "togglefullscreen" } },
      { id: "zoomIn", accelerator: "CmdOrCtrl+=", run: { role: "zoomIn" } },
      { id: "zoomOut", accelerator: "CmdOrCtrl+-", run: { role: "zoomOut" } },
      { id: "resetZoom", accelerator: "CmdOrCtrl+0", run: { role: "resetZoom" } },
      "separator",
      { id: "reload", accelerator: "CmdOrCtrl+Shift+F5", run: { command: "reload" } },
      { id: "devtools", accelerator: "CmdOrCtrl+Shift+I", run: { command: "devtools" } },
    ],
  },
  {
    id: "help",
    entries: [
      { id: "website", run: { command: "website" } },
      { id: "downloadPage", run: { command: "download-page" } },
      { id: "releases", run: { command: "releases" } },
      "separator",
      { id: "openLogs", run: { command: "open-logs" } },
      { id: "checkUpdates", run: { command: "check-updates" } },
      { id: "about", run: { command: "about" } },
    ],
  },
];

/** Menu labels per language (the menu is native, outside the page's messages). */
export const MENU_LABELS: Record<"en" | "pl" | "es", Record<string, string>> = {
  en: { file: "File", edit: "Edit", simulator: "Simulator", studio: "Studio", view: "View", help: "Help", openSong: "Open song…", openVideo: "Open video…", openProject: "Open project…", outputFolder: "Choose output folder…", quit: "Quit", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all", start: "Start / pause", restart: "Restart", find: "Find simulation", fastExport: "Fast export", record: "Record video", gpu: "GPU", queue: "Render queue", ai: "AI studio", library: "Library", fullscreen: "Full screen", zoomIn: "Zoom in", zoomOut: "Zoom out", resetZoom: "Actual size", reload: "Reload page", devtools: "Developer tools", website: "Website", downloadPage: "Download page", releases: "All releases", openLogs: "Open logs", checkUpdates: "Check for updates", about: "About", show: "Show JumpingBallsLive", trayTip: "JumpingBallsLive", trayHidden: "JumpingBallsLive keeps running in the tray – renders go on." },
  pl: { file: "Plik", edit: "Edycja", simulator: "Symulator", studio: "Studio", view: "Widok", help: "Pomoc", openSong: "Otwórz utwór…", openVideo: "Otwórz wideo…", openProject: "Otwórz projekt…", outputFolder: "Wybierz folder zapisu…", quit: "Zakończ", undo: "Cofnij", redo: "Ponów", cut: "Wytnij", copy: "Kopiuj", paste: "Wklej", selectAll: "Zaznacz wszystko", start: "Start / pauza", restart: "Od nowa", find: "Znajdź symulację", fastExport: "Szybki eksport", record: "Nagraj wideo", gpu: "GPU", queue: "Kolejka renderowania", ai: "Studio AI", library: "Biblioteka", fullscreen: "Pełny ekran", zoomIn: "Powiększ", zoomOut: "Pomniejsz", resetZoom: "Rzeczywisty rozmiar", reload: "Przeładuj stronę", devtools: "Narzędzia deweloperskie", website: "Strona internetowa", downloadPage: "Strona pobierania", releases: "Wszystkie wydania", openLogs: "Otwórz logi", checkUpdates: "Sprawdź aktualizacje", about: "O programie", show: "Pokaż JumpingBallsLive", trayTip: "JumpingBallsLive", trayHidden: "JumpingBallsLive działa dalej w zasobniku – renderowanie trwa." },
  es: { file: "Archivo", edit: "Editar", simulator: "Simulador", studio: "Estudio", view: "Ver", help: "Ayuda", openSong: "Abrir canción…", openVideo: "Abrir vídeo…", openProject: "Abrir proyecto…", outputFolder: "Elegir carpeta de salida…", quit: "Salir", undo: "Deshacer", redo: "Rehacer", cut: "Cortar", copy: "Copiar", paste: "Pegar", selectAll: "Seleccionar todo", start: "Iniciar / pausar", restart: "Reiniciar", find: "Buscar simulación", fastExport: "Exportación rápida", record: "Grabar vídeo", gpu: "GPU", queue: "Cola de renderizado", ai: "Estudio de IA", library: "Biblioteca", fullscreen: "Pantalla completa", zoomIn: "Acercar", zoomOut: "Alejar", resetZoom: "Tamaño real", reload: "Recargar página", devtools: "Herramientas de desarrollo", website: "Sitio web", downloadPage: "Página de descarga", releases: "Todas las versiones", openLogs: "Abrir registros", checkUpdates: "Buscar actualizaciones", about: "Acerca de", show: "Mostrar JumpingBallsLive", trayTip: "JumpingBallsLive", trayHidden: "JumpingBallsLive sigue en la bandeja: los renderizados continúan." },
};

export function menuLanguage(locale: string): "en" | "pl" | "es" {
  const lang = locale.toLowerCase().slice(0, 2);
  return lang === "pl" || lang === "es" ? lang : "en";
}
