export type ScreenId = "calendar" | "payments" | "accounts" | "settings";

export interface ScreenDef {
  id: ScreenId;
  title: string;
  icon: "calendar" | "list" | "wallet" | "gear";
  emptyTitle: string;
  emptyText: string;
}

export const screens: ScreenDef[] = [
  {
    id: "calendar",
    title: "Календарь",
    icon: "calendar",
    emptyTitle: "В календаре пока пусто",
    emptyText: "Когда появятся платежи, они отобразятся здесь по дням.",
  },
  {
    id: "payments",
    title: "Платежи",
    icon: "list",
    emptyTitle: "Платежей пока нет",
    emptyText: "Здесь будет список всех поступлений и списаний.",
  },
  {
    id: "accounts",
    title: "Счета",
    icon: "wallet",
    emptyTitle: "Счетов пока нет",
    emptyText: "Здесь будут твои счета и остатки на них в рублях.",
  },
  {
    id: "settings",
    title: "Настройки",
    icon: "gear",
    emptyTitle: "Настроек пока нет",
    emptyText: "Здесь появятся параметры приложения.",
  },
];

export const defaultScreen: ScreenId = "calendar";
