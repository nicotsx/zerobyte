type User = {
	id: string;
	email: string;
	username: string;
	name: string;
	hasDownloadedResticPassword: boolean;
	dateFormat: string;
	timeFormat: string;
	twoFactorEnabled?: boolean | null;
	hasPassword?: boolean;
	role?: string | null | undefined;
};

export type AppContext = {
	user: User | null;
	passwordAuthSupported: boolean;
	hasUsers: boolean;
	sidebarOpen: boolean;
	hasSkippedRecoveryKeyDownload: boolean;
};
