import {transform} from 'stream-transform';
import {Readable} from 'stream';
import parse from 'csv-parse';
import fs from 'fs';
import {printTable} from 'console-table-printer';
import prompts from 'prompts';
import ora from 'ora';
import {APIClient, IPassFailDrop} from './lib/api';

const BATCH_SIZE = 10;

interface IParsedRow {
	course: string;
	title: string;
	total: number;
	failed: number;
	dropped: number;
	year: number;
	semester: string;
}

const SEMESTER_MAPPING: Record<string, IPassFailDrop['semester']> = {
	Fall: 'FALL',
	Winter: 'SPRING',
	Spring: 'SPRING',
	Summer: 'SUMMER'
};

const SEMESTER_MONTH_MAPPING: Record<string, IPassFailDrop['semester']> = {
	'01': 'SPRING'
};

const getNRecords = async (parser: Readable, n: number): Promise<IPassFailDrop[]> => {
	const result: any[] = [];

	return new Promise<any>((resolve, reject) => {
		parser.on('data', row => {
			result.push(row);

			if (result.length >= n) {
				resolve(result);
				parser.removeAllListeners();
			}
		});
	});
};

const COURSE_TO_SECTION_COUNTER = new Map<string, number>();

const reshapeRecord = (record: IParsedRow): IPassFailDrop => {
	const subject = record.course.match(/([A-Z])+/g);
	const crse = record.course.match(/(\d)+/g);

	if (!subject || !crse) {
		throw new Error(`Could not parse ${JSON.stringify(record)}`);
	}

	const key = `${subject[0]}${crse[0]}`;

	COURSE_TO_SECTION_COUNTER.set(key, (COURSE_TO_SECTION_COUNTER.get(key) ?? 0) + 1);

	const section = (COURSE_TO_SECTION_COUNTER.get(key) ?? 1).toString().padStart(2, '0');

	return {
		courseSubject: subject[0],
		courseCrse: crse[0],
		year: record.year,
		semester: SEMESTER_MAPPING[record.semester],
		section,
		failed: record.failed,
		dropped: record.dropped,
		total: record.total
	};
};

(async () => {
	const path = process.argv[2];

	if (!fs.existsSync(path)) {
		console.error('Path to spreadsheet is invalid or doesn\'t exist.');
		process.exit(1);
	}

	const parser = fs.createReadStream(path)
		.pipe(parse({
			columns: [
				'course',
				'title',
				'total',
				'failed',
				'dropped',
				'year',
				'semester'
			],
			from: 2,
			cast: (value, context) => {
				if (['total', 'failed', 'dropped', 'year'].includes(context.column as string)) {
					if (value.trim() === '') {
						return 0;
					}

					return Number.parseInt(value, 10);
				}

				return value;
			}
		}))
		.pipe(transform((record: IParsedRow, callback) => {
			if (Number.isNaN(record.failed)) {
				callback(null, null);
				return;
			}

			callback(null, reshapeRecord(record));
		}));

	let records = (await getNRecords(parser, 10));

	console.log('This is what the data looks like so far:');
	printTable(records);

	const result = await prompts({
		type: 'confirm',
		message: 'Is it being parsed correctly?',
		name: 'parse-check'
	});

	if (!result['parse-check']) {
		process.exit(1);
	}

	// Upload data
	const {endpoint, token} = await prompts([
		{
			type: 'text',
			message: 'Authentication token',
			name: 'token'
		},
		{
			type: 'text',
			message: 'Endpoint',
			name: 'endpoint'
		}
	]);

	const client = new APIClient({endpoint, token});

	const spinner = ora('Uploading data...').start();

	// Upload in batches
	for await (const record of parser) {
		records.push(record);

		if (records.length >= BATCH_SIZE) {
			try {
				await client.putManyPassFailDrop(records);
			} catch (error: unknown) {
				console.error(records);
				throw error;
			}

			records = [];
		}
	}

	try {
		await client.putManyPassFailDrop(records);
	} catch (error: unknown) {
		console.error(records);
		throw error;
	}

	spinner.succeed('Finished uploading data.');
})();
