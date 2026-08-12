// Shared logging entry point. All content scripts share the window.BAG namespace.
window.BAG = window.BAG || {};
window.BAG.log = function (level, ...args) {
  const prefix = "%c[BAG]";
  const style = "color:#2b6cb0;font-weight:bold";
  if (level === "error") console.error(prefix, style, ...args);
  else console.log(prefix, style, ...args);
};
