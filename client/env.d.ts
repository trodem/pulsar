/// <reference types="vite/client" />

// Von Vite `define` ersetzte Kompilierzeit-Konstante (siehe vite.config.ts).
declare const __HIDE_USERS__: boolean;

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
