"use client";

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface AppState {
  // Sidebar
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Theme
  isDarkMode: boolean;
  toggleDarkMode: () => void;

  // Notifications
  unreadNotifications: number;
  setUnreadNotifications: (count: number) => void;
  incrementNotifications: () => void;
  clearNotifications: () => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        // Sidebar
        isSidebarOpen: false,
        toggleSidebar: () =>
          set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
        setSidebarOpen: (open) => set({ isSidebarOpen: open }),

        // Theme
        isDarkMode: false,
        toggleDarkMode: () =>
          set((state) => ({ isDarkMode: !state.isDarkMode })),

        // Notifications
        unreadNotifications: 0,
        setUnreadNotifications: (count) =>
          set({ unreadNotifications: count }),
        incrementNotifications: () =>
          set((state) => ({
            unreadNotifications: state.unreadNotifications + 1,
          })),
        clearNotifications: () => set({ unreadNotifications: 0 }),
      }),
      {
        name: "app-storage",
        partialize: (state) => ({
          isDarkMode: state.isDarkMode,
        }),
      }
    ),
    { name: "AppStore" }
  )
);
