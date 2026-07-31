const MAIN_STYLESHEET_SELECTOR = 'link[data-rakshakai-stylesheet="main"]';
const STYLESHEET_SELECTOR = `${MAIN_STYLESHEET_SELECTOR}, link[rel="stylesheet"]`;
const NOTICE_ID = "uiAssetFailureNotice";

function stylesheets() {
  return [...document.querySelectorAll(STYLESHEET_SELECTOR)];
}

function mainStylesApplied() {
  const rootStyle = window.getComputedStyle(document.documentElement);
  const currentStylesReady = rootStyle.getPropertyValue("--rakshakai-css-ready").trim() === "loaded";
  const legacyStylesReady = rootStyle.getPropertyValue("--teal").trim() === "#087d78";
  return currentStylesReady || legacyStylesReady;
}

function showUiAssetFailureNotice(assetUrl = "frontend stylesheet") {
  if (document.getElementById(NOTICE_ID)) return;
  const notice = document.createElement("dialog");
  notice.id = NOTICE_ID;
  notice.className = "ui-asset-failure";
  notice.setAttribute("open", "");

  const title = document.createElement("strong");
  title.textContent = "UI assets failed to load";
  const message = document.createElement("p");
  message.textContent = `${assetUrl} did not load correctly. Reload the page to recover the command center interface.`;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());

  notice.append(title, message, reload);
  document.body.prepend(notice);
}

function reportUiAssetFailure(assetUrl, detail = "Stylesheet failed to load") {
  if (import.meta.env.DEV) {
    console.error("[RakshakAI] UI asset failure", { assetUrl, detail });
  }
  showUiAssetFailureNotice(assetUrl);
}

function verifyMainStylesheet() {
  if (!mainStylesApplied()) {
    const stylesheet = stylesheets()[0];
    reportUiAssetFailure(stylesheet?.href || "frontend stylesheet", "Main stylesheet is not applied");
  }
}

function watchStylesheets() {
  stylesheets().forEach((stylesheet) => {
    stylesheet.addEventListener("error", () => {
      reportUiAssetFailure(stylesheet.href || stylesheet.getAttribute("href") || "frontend stylesheet");
    });
    stylesheet.addEventListener("load", () => {
      window.setTimeout(verifyMainStylesheet, 0);
    }, { once: true });
  });
}

watchStylesheets();

window.addEventListener("DOMContentLoaded", () => {
  window.setTimeout(verifyMainStylesheet, 1800);
});
