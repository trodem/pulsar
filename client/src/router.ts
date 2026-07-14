import { createRouter, createWebHistory } from "vue-router";
import Login from "./views/Login.vue";
import Dashboard from "./views/Dashboard.vue";
import Monitors from "./views/Monitors.vue";
import MonitorDetail from "./views/MonitorDetail.vue";
import Notifications from "./views/Notifications.vue";
import Maintenance from "./views/Maintenance.vue";
import Projects from "./views/Projects.vue";
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
    { path: "/projects", name: "projects", component: Projects },
    {
      path: "/settings",
      name: "settings",
      component: Settings,
      meta: { adminOnly: true },
    },
  ],
});

// Simple guard: redirect to /login when no token is present. Admin-only routes
// (e.g. Groups & Tags management) send read-only accounts back to the dashboard;
// the server enforces this too, this just avoids a dead page.
router.beforeEach((to) => {
  const hasToken = !!localStorage.getItem("token");
  if (!hasToken && to.name !== "login") return { name: "login" };
  if (hasToken && to.name === "login") return { name: "dashboard" };
  if (to.meta.adminOnly && localStorage.getItem("role") !== "admin") {
    return { name: "dashboard" };
  }
});

export default router;
