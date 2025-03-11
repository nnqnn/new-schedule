const sirinium = require("sirinium");

async function main() {
  const client = new sirinium.Client();
  await client.getInitialData(); // Required

  await client.changeWeek(0); // Add 1 week

  const schedule = await client.getGroupSchedule("К0709-23/1");

  console.log(schedule);
}

// Вызов асинхронной функции
main().catch(error => {
  console.error("Произошла ошибка:", error);
});