<script setup lang="ts">
import { usePreferencesStore } from '../stores/preferences';
import { translate } from '../lib/translations';

defineProps<{ name: string; inVoice: boolean; speaking: boolean; muted: boolean; volume?: number }>();
defineEmits<{ volume: [value: number] }>();
const preferences = usePreferencesStore();
const t = (key: string) => translate(preferences.language, key);
</script>

<template>
  <span v-if="inVoice" class="player-voice-controls" @click.stop @keydown.stop>
    <span class="player-voice" :class="{ talking: speaking && !muted, muted }" role="img"
      :aria-label="t(muted ? 'voice_muted_badge' : speaking ? 'voice_speaking' : 'voice_in_channel')"
      :title="t(muted ? 'voice_muted_badge' : speaking ? 'voice_speaking' : 'voice_in_channel')">
      <span v-if="speaking && !muted" class="speaking-bars" aria-hidden="true"><i></i><i></i><i></i></span>
      <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        <path v-if="muted" d="M2 2l20 20" />
      </svg>
    </span>
    <input v-if="volume !== undefined" class="roster-volume" type="range" min="0" max="100"
      :aria-label="`${name} — ${t('volume')}`" :title="`${name} — ${t('volume')}`" :value="volume"
      @input="$emit('volume', Number(($event.target as HTMLInputElement).value))" />
  </span>
</template>

<style scoped>
.player-voice-controls { display: inline-flex; align-items: center; gap: 4px; flex: none; vertical-align: middle; }
.player-voice { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; color: #376349; background: #d7e8dc; }
.player-voice.talking { color: #30210b; background: #ffd073; }
.player-voice.muted { color: #8a3644; background: #f1dbe0; }
html[data-theme="dark"] .player-voice { color: #c7ebd3; background: #2c4937; }
html[data-theme="dark"] .player-voice.talking { color: #30210b; background: #ffd073; }
html[data-theme="dark"] .player-voice.muted { color: #ffb4c2; background: #56313e; }
.speaking-bars { display: flex; align-items: center; gap: 2px; height: 14px; }
.speaking-bars i { width: 3px; height: 5px; background: currentColor; border-radius: 1px; animation: voice-level 650ms ease-in-out infinite alternate; }
.speaking-bars i:nth-child(2) { height: 12px; animation-delay: -220ms; }
.speaking-bars i:nth-child(3) { height: 8px; animation-delay: -430ms; }
.roster-volume { flex: none; width: 44px; min-width: 0; height: 20px; min-height: 20px; padding: 0; border: 0; accent-color: var(--accent); cursor: pointer; }
@keyframes voice-level { to { transform: scaleY(.4); } }
@media (prefers-reduced-motion: reduce) { .speaking-bars i { animation: none; } }
</style>
