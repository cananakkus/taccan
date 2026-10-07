<script setup lang="ts">
import { usePreferencesStore } from '../stores/preferences';
import { translate } from '../lib/translations';

const preferences = usePreferencesStore();
const t = (key: string) => translate(preferences.language, key);
</script>

<template>
  <div class="language-switch language-flags" role="group" :aria-label="t('language_label')">
    <button v-for="language in ['en', 'tr']" :key="language" class="language-flag" type="button"
      :aria-label="t(`language_${language}`)" :title="t(`language_${language}`)"
      :aria-pressed="preferences.language === language" @click="preferences.setLanguage(language)">
      <svg v-if="language === 'en'" viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#c8102e" stroke-width="3" />
        <path d="M30 0V40M0 20H60" stroke="#fff" stroke-width="12" />
        <path d="M30 0V40M0 20H60" stroke="#c8102e" stroke-width="7" />
      </svg>
      <svg v-else viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <rect width="60" height="40" fill="#e30a17" />
        <circle cx="24" cy="20" r="10" fill="#fff" />
        <circle cx="27" cy="20" r="8" fill="#e30a17" />
        <path d="M34 16.5L45 20L34 23.5L40.8 14.4L40.8 25.6Z" fill="#fff" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.language-flags{display:flex;align-items:center;gap:8px}
.language-flag{display:grid;place-items:center;width:44px;height:44px;padding:4px;border:2px solid transparent;border-radius:50%;background:transparent;cursor:pointer;flex:none}
.language-flag svg{width:32px;height:32px;border-radius:50%;box-shadow:0 0 0 1px var(--border)}
.language-flag[aria-pressed="true"]{border-color:var(--accent)}
.language-flag:hover{background:var(--accent-light)}
.language-flag:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
</style>
