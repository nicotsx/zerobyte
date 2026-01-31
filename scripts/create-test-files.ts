#!/usr/bin/env bun
/**
 * Creates temporary files for testing Zerobyte backup functionality.
 * Generates files with various sizes and content patterns.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

interface TestFile {
	name: string;
	size: number;
	content?: Buffer;
}

interface Options {
	count: number;
	minSize: number;
	maxSize: number;
	outDir: string;
	nested: boolean;
}

function parseArgs(): Options {
	const args = process.argv.slice(2);
	const options: Options = {
		count: 10,
		minSize: 1024,
		maxSize: 1024 * 1024,
		outDir: "./tmp/test-files",
		nested: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--count":
			case "-c":
				options.count = parseInt(args[++i], 10);
				break;
			case "--min-size":
			case "--minsize":
				options.minSize = parseSize(args[++i]);
				break;
			case "--max-size":
			case "--maxsize":
				options.maxSize = parseSize(args[++i]);
				break;
			case "--out":
			case "-o":
				options.outDir = args[++i];
				break;
			case "--nested":
			case "-n":
				options.nested = true;
				break;
			case "--help":
			case "-h":
				printHelp();
				process.exit(0);
		}
	}

	return options;
}

function parseSize(size: string): number {
	const match = size.match(/^(\d+)([kmgt]?)b?$/i);
	if (!match) {
		throw new Error(`Invalid size format: ${size}`);
	}
	const num = parseInt(match[1], 10);
	const unit = match[2].toLowerCase();
	const multipliers: Record<string, number> = {
		"": 1,
		k: 1024,
		m: 1024 * 1024,
		g: 1024 * 1024 * 1024,
		t: 1024 * 1024 * 1024 * 1024,
	};
	return num * (multipliers[unit] || 1);
}

function printHelp(): void {
	console.info(`
Usage: bun create-test-files.ts [options]

Options:
  -c, --count <num>      Number of files to create (default: 10)
  --min-size <size>      Minimum file size (default: 1K)
  --max-size <size>      Maximum file size (default: 1M)
  -o, --out <dir>        Output directory (default: ./tmp/test-files)
  -n, --nested           Create files in nested subdirectories
  -h, --help             Show this help message

Size format: <number>[K|M|G|T][B] (e.g., 100K, 5M, 1G)
`);
}

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateContent(size: number): Buffer {
	const content = Buffer.alloc(size);
	for (let i = 0; i < size; i++) {
		content[i] = randomInt(32, 126);
	}
	return content;
}

async function createFiles(options: Options): Promise<void> {
	console.info(`Creating ${options.count} test files...`);
	console.info(`  Output directory: ${options.outDir}`);
	console.info(`  Size range: ${formatSize(options.minSize)} - ${formatSize(options.maxSize)}`);
	console.info(`  Nested: ${options.nested}`);

	await mkdir(options.outDir, { recursive: true });

	const files: TestFile[] = [];
	for (let i = 0; i < options.count; i++) {
		const size = randomInt(options.minSize, options.maxSize);
		const fileNum = i + 1;

		let dir = options.outDir;
		if (options.nested) {
			const depth = randomInt(1, 3);
			const parts: string[] = [];
			for (let d = 0; d < depth; d++) {
				parts.push(`level${d + 1}`);
			}
			dir = join(options.outDir, ...parts);
		}

		const name = join(dir, `test-file-${fileNum.toString().padStart(4, "0")}.txt`);
		files.push({ name, size });
	}

	let totalSize = 0;
	for (const file of files) {
		await mkdir(file.name.substring(0, file.name.lastIndexOf("/")), { recursive: true });
		const content = generateContent(file.size);
		await writeFile(file.name, content);
		totalSize += file.size;
		process.stdout.write(`\r  Created ${files.indexOf(file) + 1}/${options.count} files`);
	}

	console.info(`\nDone! Created ${options.count} files totaling ${formatSize(totalSize)}`);
	console.info(`Location: ${options.outDir}`);
}

function formatSize(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = bytes;
	let unitIndex = 0;
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}
	return `${size.toFixed(2)} ${units[unitIndex]}`;
}

async function main(): Promise<void> {
	try {
		const options = parseArgs();
		await createFiles(options);
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

void main();
