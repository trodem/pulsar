import { createRouter, createWebHistory } from "vue-router";
import Login from "./views/Login.vue";
import Dashboard from "./views/Dashboard.vue";
import MonitorDetail from "./views/MonitorDetail.vue";
import Notifications from "./views/Notifications.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: Login },
    { path: "/", name: "dashboard", component: Dashboard },
    { path: "/monitor/:id", name: "monitor", component: MonitorDetail },
    { path: "/notifications", name: "notifications", component: Notifications },
  ],
});

// Simple guard: redirect to /login when no token is present.
router.beforeEach((to) => {
  const hasToken = !!localStorage.getItem("token");
  if (!hasToken && to.name !== "login") return { name: "login" };
  if (hasToken && to.name === "login") return { name: "dashboard" };
});

export default router;
