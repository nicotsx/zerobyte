import { useCallback, useMemo, useState } from "react";
import type { FileEntry } from "../components/file-tree";

export type FetchFolderResult = {
	files?: FileEntry[];
	directories?: Array<{ name: string; path: string }>;
	offset?: number;
	limit?: number;
	total?: number;
	hasMore?: boolean;
};

type FetchFolderFn = (path: string, offset?: number) => Promise<FetchFolderResult>;

type PathTransformFns = {
	strip?: (path: string) => string;
	add?: (path: string) => string;
};

type UseFileBrowserOptions = {
	initialData?: FetchFolderResult;
	isLoading?: boolean;
	fetchFolder: FetchFolderFn;
	prefetchFolder?: (path: string) => void;
	pathTransform?: PathTransformFns;
	rootPath?: string;
};

type FolderPaginationState = {
	currentOffset: number;
	limit: number;
	hasMore: boolean;
	isLoadingMore: boolean;
};

export const useFileBrowser = (props: UseFileBrowserOptions) => {
	const { initialData, isLoading, fetchFolder, prefetchFolder, pathTransform, rootPath = "/" } = props;
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
	const [fetchedFolders, setFetchedFolders] = useState<Set<string>>(new Set([rootPath]));
	const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
	const [allFiles, setAllFiles] = useState<Map<string, FileEntry>>(new Map());
	const [folderPagination, setFolderPagination] = useState<Map<string, FolderPaginationState>>(new Map());

	const stripPath = pathTransform?.strip;
	const addPath = pathTransform?.add;

	useMemo(() => {
		if (initialData?.files) {
			const files = initialData.files;
			setAllFiles((prev) => {
				const next = new Map(prev);
				for (const file of files) {
					const path = stripPath ? stripPath(file.path) : file.path;
					if (path !== rootPath) {
						next.set(path, { ...file, path });
					}
				}
				return next;
			});
			if (rootPath) {
				setFetchedFolders((prev) => new Set(prev).add(rootPath));
				setFolderPagination((prev) => {
					const next = new Map(prev);
					next.set(rootPath, {
						currentOffset: initialData.offset ?? 0,
						limit: initialData.limit ?? 100,
						hasMore: initialData.hasMore ?? false,
						isLoadingMore: false,
					});
					return next;
				});
			}
		} else if (initialData?.directories) {
			const directories = initialData.directories;
			setAllFiles((prev) => {
				const next = new Map(prev);
				for (const dir of directories) {
					next.set(dir.path, { name: dir.name, path: dir.path, type: "folder" });
				}
				return next;
			});
		}
	}, [initialData, stripPath, rootPath]);

	const fileArray = useMemo(() => Array.from(allFiles.values()), [allFiles]);

	const handleFolderExpand = useCallback(
		async (folderPath: string) => {
			setExpandedFolders((prev) => {
				const next = new Set(prev);
				next.add(folderPath);
				return next;
			});

			if (!fetchedFolders.has(folderPath)) {
				setLoadingFolders((prev) => new Set(prev).add(folderPath));

				try {
					const pathToFetch = addPath ? addPath(folderPath) : folderPath;
					const result = await fetchFolder(pathToFetch);

					if (result.files) {
						const files = result.files;
						setAllFiles((prev) => {
							const next = new Map(prev);
							for (const file of files) {
								const strippedPath = stripPath ? stripPath(file.path) : file.path;
								// Skip the directory itself
								if (strippedPath !== folderPath) {
									next.set(strippedPath, { ...file, path: strippedPath });
								}
							}
							return next;
						});
						setFolderPagination((prev) => {
							const next = new Map(prev);
							next.set(folderPath, {
								currentOffset: result.offset ?? 0,
								limit: result.limit ?? 100,
								hasMore: result.hasMore ?? false,
								isLoadingMore: false,
							});
							return next;
						});
					} else if (result.directories) {
						const directories = result.directories;
						setAllFiles((prev) => {
							const next = new Map(prev);
							for (const dir of directories) {
								next.set(dir.path, { name: dir.name, path: dir.path, type: "folder" });
							}
							return next;
						});
					}

					setFetchedFolders((prev) => new Set(prev).add(folderPath));
				} catch (error) {
					console.error("Failed to fetch folder contents:", error);
				} finally {
					setLoadingFolders((prev) => {
						const next = new Set(prev);
						next.delete(folderPath);
						return next;
					});
				}
			}
		},
		[fetchedFolders, fetchFolder, stripPath, addPath],
	);

	const handleLoadMore = useCallback(
		async (folderPath: string) => {
			const pagination = folderPagination.get(folderPath);
			if (!pagination?.hasMore || pagination?.isLoadingMore) {
				return;
			}

			setFolderPagination((prev) => {
				const next = new Map(prev);
				next.set(folderPath, { ...pagination, isLoadingMore: true });
				return next;
			});

			try {
				const pathToFetch = addPath ? addPath(folderPath) : folderPath;
				const nextOffset = pagination.currentOffset + pagination.limit;
				const result = await fetchFolder(pathToFetch, nextOffset);

				if (result.files) {
					const files = result.files;
					setAllFiles((prev) => {
						const next = new Map(prev);
						for (const file of files) {
							const strippedPath = stripPath ? stripPath(file.path) : file.path;
							if (strippedPath !== folderPath) {
								next.set(strippedPath, { ...file, path: strippedPath });
							}
						}
						return next;
					});
					setFolderPagination((prev) => {
						const next = new Map(prev);
						next.set(folderPath, {
							currentOffset: result.offset ?? nextOffset,
							limit: result.limit ?? pagination.limit,
							hasMore: result.hasMore ?? false,
							isLoadingMore: false,
						});
						return next;
					});
				}
			} catch (error) {
				console.error("Failed to load more files:", error);
				setFolderPagination((prev) => {
					const next = new Map(prev);
					next.set(folderPath, { ...pagination, isLoadingMore: false });
					return next;
				});
			}
		},
		[folderPagination, fetchFolder, stripPath, addPath],
	);

	const handleFolderHover = useCallback(
		(folderPath: string) => {
			if (!fetchedFolders.has(folderPath) && !loadingFolders.has(folderPath) && prefetchFolder) {
				const pathToPrefetch = addPath ? addPath(folderPath) : folderPath;
				prefetchFolder(pathToPrefetch);
			}
		},
		[fetchedFolders, loadingFolders, prefetchFolder, addPath],
	);

	const getFolderPagination = useCallback(
		(folderPath: string) => {
			return folderPagination.get(folderPath) ?? { hasMore: false, isLoadingMore: false };
		},
		[folderPagination],
	);

	return {
		fileArray,
		expandedFolders,
		loadingFolders,
		handleFolderExpand,
		handleFolderHover,
		handleLoadMore,
		getFolderPagination,
		isLoading: isLoading && fileArray.length === 0,
		isEmpty: fileArray.length === 0 && !isLoading,
	};
};
