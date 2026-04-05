import { createRouter, createWebHistory } from 'vue-router';

import GameView from './components/GameView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/:pathMatch(.*)*',
      component: GameView,
    },
  ],
});
