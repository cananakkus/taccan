import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import AccountControls from '../AccountControls.vue';
import { usePreferencesStore } from '../../stores/preferences';

beforeEach(() => setActivePinia(createPinia()));

afterEach(() => { delete (window as any).Wleeaf; });
it('lets standalone guests play without account errors', async () => {
  const wrapper = mount(AccountControls);
  await flushPromises();
  expect(wrapper.find('section').exists()).toBe(false);
  wrapper.unmount();
});
it('clears the displayed identity after signing out', async () => {
  (window as any).Wleeaf = { me: async () => ({ user: { name: 'Player' } }), logout: vi.fn(async () => {}) };
  const wrapper = mount(AccountControls);
  await flushPromises();
  expect(wrapper.text()).toContain('Player');
  await wrapper.find('button').trigger('click');
  await flushPromises();
  expect(wrapper.text()).not.toContain('Playing as');
  expect(wrapper.emitted('identity')).toEqual([['Player'], ['']]);
  wrapper.unmount();
});
it('reports sign-in failures without an unhandled rejection', async () => {
  (window as any).Wleeaf = { me: async () => ({ user: null }), login: async () => { throw new Error('offline'); } };
  const wrapper = mount(AccountControls);
  await flushPromises();
  await wrapper.find('button').trigger('click');
  await flushPromises();
  expect(wrapper.find('[role="status"]').text()).toContain('Could not sign in');
  wrapper.unmount();
});

it('updates account labels and an existing error when switching to Turkish', async () => {
  (window as any).Wleeaf = { me: async () => ({ user: null }), login: async () => { throw new Error('offline'); } };
  const wrapper = mount(AccountControls);
  await flushPromises();
  await wrapper.find('button').trigger('click');
  await flushPromises();
  usePreferencesStore().setLanguage('tr');
  await flushPromises();
  expect(wrapper.find('button').text()).toBe('wleeaf ile giriş yap');
  expect(wrapper.find('[role="status"]').text()).toBe('Giriş yapılamadı. Lütfen tekrar dene.');
  wrapper.unmount();
});
