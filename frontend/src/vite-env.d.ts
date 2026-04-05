/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

declare global {
  interface Window {
    TACCAN_TRANSLATIONS?: TranslationPayload;
  }
}

export interface TranslationPayload {
  defaultLanguage?: string;
  supportedLanguages?: string[];
  strings?: Record<string, Record<string, string>>;
  words?: Record<string, Record<string, string>>;
}
