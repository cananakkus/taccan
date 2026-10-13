// Fonts are bundled (hashed, same origin): no render-blocking trip to Google Fonts.
import '@fontsource/playfair-display-sc/400.css';
import '@fontsource/playfair-display-sc/700.css';
import '@fontsource/playfair-display-sc/900.css';
import '@fontsource/crimson-pro/300.css';
import '@fontsource/crimson-pro/400.css';
import '@fontsource/crimson-pro/400-italic.css';
import '@fontsource/crimson-pro/600.css';
import '@fontsource/crimson-pro/700.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import { router } from './router';
import '../style.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount('#app');
