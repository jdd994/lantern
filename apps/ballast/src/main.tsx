import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setReceiptReader } from "./lib/receipt";
import { tesseractReader } from "./lib/ocr";
import "@lantern/ui/styles.css";
import "./styles.css";

// On-device receipt reading. Registering the reader costs nothing here — the
// engine itself lazy-loads inside read(), the first time a receipt is scanned.
setReceiptReader(tesseractReader);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
