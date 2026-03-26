type User = {
	id: string;
	email: string;
	username: string;
	name: string;
	hasDownloadedResticPassword: boolean;
	dateFormat: string;
	timeFormat: string;
	twoFactorEnabled?: boolean | null;
	role?: string | null | undefined;
};

export type AppContext = {
	user: User | null;
	hasUsers: boolean;
	sidebarOpen: boolean;
};
