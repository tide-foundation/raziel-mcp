import React from "react";
import ReactDOM from "react-dom/client";
import { TideCloakProvider } from "@tidecloak/react";
import App from "./App";
import tcConfig from "../public/tidecloak.json";

// The provider takes the adapter JSON directly as the config prop.
// useDPoP goes inside the config object, not as a separate JSX prop (I-12).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TideCloakProvider
      config={{ ...tcConfig, useDPoP: { mode: "strict", alg: "ES256" } }}
    >
      <App />
    </TideCloakProvider>
  </React.StrictMode>
);
