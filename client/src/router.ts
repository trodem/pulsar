import { createRouter, createWebHistory } from "vue-router";
import Login from "./views/Login.vue";
import Dashboard from "./views/Dashboard.vue";
import Monitors from "./views/Monitors.vue";
import MonitorDetail from "./views/MonitorDetail.vue";
import Notifications from "./views/Notifications.vue";
import Maintenance from "./views/Maintenance.vue";
import Settings from "./views/Settings.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: Login },
    { path: "/", name: "dashboard", component: Dashboard },
    { path: "/monitors", name: "monitors", component: Monitors },
    { path: "/monitor/:id", name: "monitor", component: MonitorDetail },
    { path: "/notifications", name: "notifications", component: Notifications },
    { path: "/maintenance", name: "maintenance", component: Maintenance },
    { path: "/settings", name: "settings", component: Settings },
  ],
});

// Simple guard: redirect to /login when no token is present.
router.beforeEach((to) => {
  const hasToken = !!localStorage.getItem("token");
  if (!hasToken && to.name !== "login") return { name: "login" };
  if (hasToken && to.name === "login") return { name: "dashboard" };
});

export default router;
