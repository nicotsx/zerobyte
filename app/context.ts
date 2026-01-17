import { createContext } from "react-router";

type User = {
	id: string;
	email: string;
	username: string;
	hasDownloadedResticPassword: boolean;
	twoFactorEnabled?: boolean | null;
	role?: string | null | undefined;
};

type AppContext = {
	user: User | null;
	hasUsers: boolean;
};

export const appContext = createContext<AppContext>({
	user: null,
	hasUsers: false,
});
