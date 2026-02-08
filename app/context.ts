type User = {
	id: string;
	email: string;
	username: string;
	hasDownloadedResticPassword: boolean;
	twoFactorEnabled?: boolean | null;
	role?: string | null | undefined;
};

export type AppContext = {
	user: User | null;
	hasUsers: boolean;
};
