import {generateAsync} from "./map/generatedWorlds";
import {loadOnlineMap} from "./multiplayer/map";
import {createOnlineGame} from "./multiplayer/setup";
import {serverURL,type OnlineClient} from "./multiplayer/Client";
import type {MatchInfo} from "./multiplayer/protocol";
import type {GameSettings} from "./core/types";
import { WorldLoading, loadingFrame } from "./ui/WorldLoading";
import { loadWorld } from "./map/worlds";
import { showMenu } from "./ui/Menu";
import { h } from "./ui/dom";

const ui = document.getElementById("ui")!;
const labelsEl = document.getElementById("labels")!;

const selectable = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest("input, textarea, [contenteditable='true']");

document.addEventListener("selectstart", (e) => {
  if (!selectable(e.target)) e.preventDefault();
});
document.addEventListener("dragstart", (e) => {
  if (!selectable(e.target)) e.preventDefault();
});

async function main() {
  const canvas = document.getElementById("globe") as HTMLCanvasElement;
  canvas.style.visibility = "hidden";

  const launch = async (settings:GameSettings, online?:{info:MatchInfo;client:OnlineClient}) => {
    const loading = new WorldLoading(ui);
    labelsEl.style.visibility = "hidden";
    await loadingFrame();
    await loadingFrame();
    try {
      const [map, { App }, { GlobeRenderer }] = await Promise.all([
        online ? loadOnlineMap(serverURL+online.info.mapURL,online.info.mapHash) : settings.customWorld ? generateAsync(settings.customWorld,(m,n)=>loading.set(m,n*.6)) : loadWorld(settings.world, (m) => loading.set(m, m.includes("terrain") ? 45 : m.includes("Grouping") ? 55 : m.includes("Splitting") ? 30 : 12)),
        import("./app/App"),
        import("./render/GlobeRenderer"),
      ]);
      loading.set("Loading icons and unit sprites…", 60);
      const [{ whenHudGlyphsReady }, { whenTrainSpritesReady }] = await Promise.all([import("./ui/icons"), import("./render/UnitLayer")]);
      await Promise.all([new Promise<void>(whenHudGlyphsReady), new Promise<void>(whenTrainSpritesReady), document.fonts.ready]);
      loading.set("Preparing the globe…", 68);
      await loadingFrame();
      const globe = new GlobeRenderer(canvas, map);
      const app = new App(map, globe, ui, labelsEl);
      const game=online?await createOnlineGame(map,settings,online.info.members,online.client.profile!.id):undefined;
      await app.start(settings, (message, percent) => loading.set(message, percent),online&&game?{client:online.client,game}:undefined);
      canvas.style.visibility = "visible";
      labelsEl.style.visibility = "visible";
      loading.finish();
      (window as unknown as { __map: unknown; __globe: unknown }).__map = map;
      (window as unknown as { __map: unknown; __globe: unknown }).__globe = globe;
    } catch (e) {
      loading.fail(e);
      console.error(e);
    }
  };
  showMenu(ui,settings=>void launch(settings),(info,client)=>void launch(info.settings,{info,client}));
  // Build only the selected world; a second high-resolution map competes with match startup.
}

main().catch((e) => {
  const status = h("div", { class: "loading" }, "Error: " + (e as Error).message);
  ui.appendChild(status);
  console.error(e);
});
