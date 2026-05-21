// webpack.config.js
"use strict";
const path = require("path");

/** @param {Record<string, unknown>} _env @param {{ mode?: string }} argv */
module.exports = (_env, argv) => {
  const mode = argv.mode || "development";
  const isProduction = mode === "production";

  // 1. Configuración para el motor de la extensión (Backend)
  const extensionConfig = {
    target: "node",
    mode,
    devtool: isProduction ? "hidden-source-map" : "source-map",
    entry: "./src/extension.ts",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "extension.js",
      libraryTarget: "commonjs",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [{ loader: "ts-loader" }],
        },
      ],
    },
    externals: {
      vscode: "commonjs vscode",
    },
  };

  // 2. Configuración para el panel de React (Frontend Webview)
  const webviewConfig = {
    target: "web",
    mode,
    devtool: isProduction ? "hidden-source-map" : "source-map",
    entry: "./src/webview/index.tsx",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "webview.js",
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [{ loader: "ts-loader" }],
        },
      ],
    },
  };

  return [extensionConfig, webviewConfig];
};
