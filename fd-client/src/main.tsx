import React from "react";
import ReactDOM from "react-dom/client";
// 使用扩展版 App，包含新增的服务端交互功能
// 如需使用原有版本，可改回导入 App from "./App"
import AppNew from "./AppNew";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppNew />
  </React.StrictMode>,
);

