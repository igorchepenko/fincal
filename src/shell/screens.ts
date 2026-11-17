export type ScreenId = "calendar" | "events" | "payments" | "budget" | "accounts";

export interface ScreenDef {
  id: ScreenId;
  title: string;
  icon: "calendar" | "list" | "wallet" | "repeat" | "chart";
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
    id: "events",
    title: "События",
    icon: "repeat",
    emptyTitle: "Событий пока нет",
    emptyText: "Здесь будут повторяющиеся и разовые поступления и списания.",
  },
  {
    id: "payments",
    title: "Платежи",
    icon: "list",
    emptyTitle: "Платежей пока нет",
    emptyText: "Здесь будет список всех платежей из всех событий.",
  },
  {
    id: "budget",
    title: "Бюджет",
    icon: "chart",
    emptyTitle: "Бюджета пока нет",
    emptyText: "Здесь будет график баланса и движения денег за выбранный период.",
  },
  {
    id: "accounts",
    title: "Счета",
    icon: "wallet",
    emptyTitle: "Счетов пока нет",
    emptyText: "Здесь будут твои счета и остатки на них в рублях.",
  },
];

export const defaultScreen: ScreenId = "calendar";
