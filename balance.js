exports.command = "balance <wallet> [ledger]";
exports.desc = "Check balances in a wallet";
exports.builder = yargs => yargs;
exports.handler = config => {
	require(".").connect(config).then(xmm => {
		const wallet = config.wallet;
		const ledger = config.ledger;

		xmm.balance(wallet, ledger).then(lines => {
			lines = lines.map(line => line.human);
			console.info(lines.join("\n"));
			process.exit();
		}).catch(global.abort);
	}).catch(global.abort);
};
