"use strict";

function talmud(src, dst, stake)
{
	const sell = stake * src / (1 + stake);
	const buy = stake * dst / (1 - stake);
	const ratio = (1 - sell / src) * (1 + buy / dst);

	return {
		stake: stake,
		price: buy / sell,
		sell: sell,
		buy: buy,
		ratio: ratio
	};
}

function decide(entry)
{
	const need = entry.need;
	const proper = entry.proper;
	const offer = entry.offer;
	const active = entry.active.sort((a, b) => {
		if (a.ratio < b.ratio)
			return -1;
		else
			return 1;
	});
	const best = active.pop();

	entry.best = best;
	entry.rest = active;

	if (!best && need)
		return "absent";

	if (best) {
		const ratio = best.ratio;
		const delta = best.price / proper.price - 1;

		offer.ratio = ratio;
		offer.delta = delta;
		offer.seq = best.seq;
		offer.old = best.human;

		if (ratio < Math.sqrt(proper.ratio)) {
			if (need)
				return "bad";
			else
				return "zombie";
		}

		if (delta > proper.stake)
			if (need)
				return "far";
	}
}

exports.command = "hedge <me>";
exports.desc = "Apply the Talmud strategy";
exports.aliases = [
	"run",
	"talmud"
];
exports.builder = yargs => yargs;
exports.handler = connect((config, xmm) => {
	const id = xmm.parse(config.me);
	const me = id.human;
	const wallet = id.wallet;
	const ledger = config.ledger;
	const cancel = (p, offer) => p.then(() => {
		return xmm.cancel(offer).then(print);
	});
	const create = (p, offer) => p.then(() => {
		return xmm.create(offer).then(print);
	});
	const select = (offers, saldo) => {
		const assets = config.hedge.map(asset => {
			asset = `${asset}@${me}`;
			asset = xmm.parse(asset);
			return asset.human;
		}).filter(asset => saldo[asset]);
		let n = assets.length;

		if (n < 2)
			return;

		if (n > 2)
			n = assets.push(assets[0]);

		for (let i = 0; i < n - 1; i++) {
			const left = assets[i];
			const right = assets[i + 1];

			offers[`${left}/${right}`].need = true;
			offers[`${right}/${left}`].need = true;
		}
	};
	const getoffer = (entry) => {
		const proper = entry.proper;
		const src = xmm.parse(entry.src);
		const dst = xmm.parse(entry.dst);

		return xmm.parse({
			type: "offer",
			base: src.asset,
			asset: dst.asset,
			value: proper.buy,
			cost: proper.sell,
			wallet: wallet
		});
	};
	const compute = (saldo) => {
		const assets = Object.keys(saldo);
		const cost = config.maxfee / saldo[`XRP@${me}`];
		const stake = assets.length * Math.sqrt(cost);
		const offers = {};

		assets.forEach(base => {
			assets.forEach(asset => {
				const pair = `${asset}/${base}`;
				const src = saldo[base];
				const dst = saldo[asset];
				let proper, offer, entry;

				if (asset == base)
					return;

				proper = talmud(src, dst, stake);

				entry = {
					src: base,
					dst: asset,
					proper: proper,
					active: []
				};
				entry.offer = getoffer(entry);
				offers[pair] = entry;
			});
		});

		select(offers, saldo);
		return offers;
	};

	Promise.all([
		xmm.balance(me, ledger),
		xmm.offers(me, ledger)
	]).then(state => {
		const saldo = {};
		const zombie = [];
		const bad = [];
		const absent = [];
		const far = [];
		let offers, script;

		state[0].forEach(line => {
			const value = line.value;

			if (value > 0) {
				const asset = xmm.parse({
					type: "asset",
					asset: line.asset,
					wallet: wallet
				}).human;

				saldo[asset] = value;
				return true;
			}
		});

		offers = compute(saldo);

		state[1].forEach(line => {
			const src = xmm.parse({
				type: "asset",
				asset: line.base,
				wallet: wallet
			}).human;
			const dst = xmm.parse({
				type: "asset",
				asset: line.asset,
				wallet: wallet
			}).human;
			const pair = offers[`${dst}/${src}`];
			let ratio = 1;

			if (!pair)
				return;

			ratio *= 1 - line.cost / saldo[src];
			ratio *= 1 + line.value / saldo[dst];
			line.ratio = ratio;

			pair.active.push(line);
		});

		for (const pair in offers) {
			const entry = offers[pair];
			const status = decide(entry);

			if ("zombie" == status)
				zombie.push(entry.best);

			if ("bad" == status)
				bad.push(entry.offer);

			if ("absent" == status)
				absent.push(entry.offer);

			if ("far" == status)
				far.push(entry.offer);

			zombie.push.apply(zombie, entry.rest);
		}

		script = Promise.resolve();
		script = zombie.reduce(cancel, script);
		script = bad.sort((a, b) => {
			if (a.ratio < b.ratio)
				return -1;
			else
				return 1;
		}).reduce(create, script);
		script = absent.reduce(create, script);
		script = far.sort((a, b) => {
			if (a.delta > b.delta)
				return -1;
			else
				return 1;
		}).reduce(create, script);
		script.then(() => {
			process.exit();
		}).catch(abort);
	}).catch(abort);
});
