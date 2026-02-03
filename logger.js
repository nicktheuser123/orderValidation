function money(n) {
  return Number(n || 0).toFixed(2);
}

function logSection(title) {
  console.log("\n==============================");
  console.log(title);
  console.log("==============================");
}

module.exports = { money, logSection };
