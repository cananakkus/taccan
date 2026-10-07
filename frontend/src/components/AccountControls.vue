<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { usePreferencesStore } from '../stores/preferences';
import { translate } from '../lib/translations';

defineProps<{ compact?: boolean }>();
const emit = defineEmits<{ identity: [name: string] }>();
const preferences = usePreferencesStore();
const t = (key: string, vars: Record<string, string | number> = {}) => translate(preferences.language, key, vars);
const user = ref<{ name: string } | null>(null);
const ready = ref(false);
const error = ref('');
const account = () => (window as any).Wleeaf;

onMounted(async () => {
  try {
    if (typeof account()?.me !== 'function') return;
    user.value = (await account().me()).user;
    emit('identity', user.value?.name ?? '');
  } catch {
    error.value = 'account_unavailable';
  } finally {
    ready.value = true;
  }
});

async function signIn() {
  error.value = '';
  try {
    await account().login();
  } catch {
    error.value = 'account_sign_in_failed';
  }
}

async function signOut() {
  error.value = '';
  try {
    await account().logout();
    user.value = null;
    emit('identity', '');
  } catch {
    error.value = 'account_sign_out_failed';
  }
}
</script>
<template>
  <section v-if="account() || !ready" class="account-controls" :class="{ compact }" :aria-label="t('account_label')">
    <template v-if="user">
      <span class="account-identity">{{ t('account_playing_as', { name: user.name }) }}</span>
      <div><a class="btn btn-ghost btn-sm" href="/account/">{{ t('account_manage') }}</a><button class="btn btn-ghost btn-sm" type="button" @click="signOut">{{ t('account_sign_out') }}</button></div>
    </template>
    <button v-else-if="ready" class="btn btn-ghost btn-sm" type="button" @click="signIn">{{ t('account_sign_in') }}</button>
    <span v-else>{{ t('account_checking') }}</span>
    <p v-if="error" role="status">{{ t(error) }}</p>
  </section>
</template>
<style scoped>
.account-controls{border-block:1px solid var(--border);padding:12px 0;margin:12px 0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--ink-muted)}
.account-identity{color:var(--ink);overflow-wrap:anywhere;min-width:0}.account-controls div{display:flex;gap:8px}.account-controls a{text-decoration:none}
.account-controls.compact{border:0;padding:0;margin:0;justify-content:flex-end}.account-controls p{flex-basis:100%;margin:0}.account-controls.compact p{text-align:right}
</style>
