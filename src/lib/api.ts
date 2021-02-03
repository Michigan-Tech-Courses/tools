import got, {Got} from 'got/dist/source';

export interface IPassFailDrop {
	courseSubject: string;
	courseCrse: string;
	year: number;
	semester: 'FALL' | 'SPRING' | 'SUMMER';
	section: string;
	failed: number;
	dropped: number;
	total: number;
}

export class APIClient {
	private readonly client: typeof got;

	constructor({endpoint, token}: {endpoint: string; token: string}) {
		this.client = got.extend({
			prefixUrl: endpoint,
			headers: {
				Authorization: `Bearer ${token}`
			}
		});
	}

	async putManyPassFailDrop(data: IPassFailDrop[]) {
		await this.client.put('passfaildrop/many', {
			json: data
		});
	}
}
