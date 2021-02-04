import parse from 'csv-parse';
import fs from 'fs';
import {printTable} from 'console-table-printer';
import prompts from 'prompts';
import ora from 'ora';
import {APIClient, IPassFailDrop} from './lib/api';

const BATCH_SIZE = 100;

interface IParsedRow {
	course: string;
	title: string;
	termcode: string;
	year: number;
	semester: string;
	section: string;
	failed: number;
	dropped: number;
	total: number;
}

const SEMESTER_MAPPING: Record<string, IPassFailDrop['semester']> = {
	Fall: 'FALL',
	Winter: 'SPRING',
	Spring: 'SPRING',
	Summer: 'SUMMER'
};

const getNRecords = async (parser: parse.Parser, n: number): Promise<IParsedRow[]> => {
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

const reshapeRecord = (record: IParsedRow): IPassFailDrop => {
	const subject = record.course.match(/([A-Z])+/g);
	const crse = record.course.match(/(\d)+/g);

	if (!subject || !crse) {
		throw new Error(`Could not parse ${JSON.stringify(record)}`);
	}

	return {
		courseSubject: subject[0],
		courseCrse: crse[0],
		year: record.year,
		semester: SEMESTER_MAPPING[record.semester],
		section: record.section,
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

	const parser = fs.createReadStream(path).pipe(parse({
		columns: [
			'course',
			'title',
			'termcode',
			'year',
			'semester',
			'section',
			'failed',
			'dropped',
			'total'
		],
		from: 2,
		cast: (value, context) => {
			if ([3, 6, 7, 8].includes(context.index)) {
				if (value.trim() === '') {
					return 0;
				}

				return Number.parseInt(value, 10);
			}

			return value;
		}
	}));

	let records = (await getNRecords(parser, 5)).map(record => reshapeRecord(record));

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
		if (records.length >= BATCH_SIZE) {
			await client.putManyPassFailDrop(records);
			records = [];
		}

		// Omit empty rows
		if (record.course !== '') {
			records.push(reshapeRecord(record));
		}
	}

	await client.putManyPassFailDrop(records);

	spinner.succeed('Finished uploading data.');
})();
