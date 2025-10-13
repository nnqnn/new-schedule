const sirinium = require('sirinium');

/**
 * Форматирует дату в формат iCalendar (YYYYMMDDTHHMMSS)
 * @param {Date} date - Дата для форматирования
 * @returns {string} - Отформатированная дата
 */
function formatDateForICS(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Создает событие iCalendar из данных расписания
 * @param {Object} event - Событие расписания
 * @returns {string} - Событие в формате iCalendar
 */
function createICSEvent(event) {
    // Парсим дату из формата DD.MM.YYYY и время HH:MM
    const [day, month, year] = event.date.split('.');
    const [startHour, startMinute] = event.startTime.split(':');
    const [endHour, endMinute] = event.endTime.split(':');
    
    const dtstart = new Date(year, month - 1, day, startHour, startMinute);
    const dtend = new Date(year, month - 1, day, endHour, endMinute);
    const dtstamp = new Date();
    
    // Экранируем специальные символы для iCalendar
    const escapeICS = (str) => {
        return String(str || '')
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    };

    // Формируем название события
    const summary = escapeICS(event.discipline || 'Занятие');
    
    // Формируем location из classroom (убираем символ _)
    const classroom = event.classroom ? event.classroom.replace(/_/g, ' ') : '';
    const location = escapeICS(classroom);
    
    // Формируем description из преподавателей
    const descriptionParts = [];
    if (event.teachers) {
        const teacherNames = Object.values(event.teachers)
            .map(t => t.fio)
            .join(', ');
        if (teacherNames) descriptionParts.push(teacherNames);
    }
    if (event.comment) descriptionParts.push(`Комментарий: ${event.comment}`);
    const description = escapeICS(descriptionParts.join('\\n'));
    
    // Генерируем уникальный ID
    const uid = `${event.date}-${event.startTime}-${event.group || 'schedule'}@schedule`;

    return [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${formatDateForICS(dtstamp)}`,
        `DTSTART:${formatDateForICS(dtstart)}`,
        `DTEND:${formatDateForICS(dtend)}`,
        `SUMMARY:${summary}`,
        location ? `LOCATION:${location}` : '',
        description ? `DESCRIPTION:${description}` : '',
        'STATUS:CONFIRMED',
        'END:VEVENT'
    ].filter(line => line).join('\r\n');
}

/**
 * Создает календарь в формате iCalendar из массива событий
 * @param {Array} events - Массив событий расписания
 * @param {string} calendarName - Название календаря
 * @returns {string} - Календарь в формате iCalendar
 */
function createICSCalendar(events, calendarName = 'Расписание') {
    const icsEvents = events.map(event => createICSEvent(event)).join('\r\n');
    
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Schedule Calendar//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${calendarName}`,
        'X-WR-TIMEZONE:Europe/Moscow',
        icsEvents,
        'END:VCALENDAR'
    ].join('\r\n');
}

/**
 * Получает расписание группы на текущую и следующую недели в одном календаре
 * @param {string} group - Название/ID группы
 * @returns {Promise<string>} - Объединенный календарь в формате iCalendar
 */
async function getCalendar(group) {
    const client = new sirinium.Client();
    await client.getInitialData();
    
    // Получаем расписание текущей недели
    await client.changeWeek(0);
    const currentWeek = await client.getGroupSchedule(group);
    
    // Переключаемся на следующую неделю
    await client.changeWeek(1);
    const nextWeek = await client.getGroupSchedule(group);
    
    // Объединяем события
    const allEvents = [...currentWeek, ...nextWeek];
    
    return createICSCalendar(allEvents, `Расписание ${group} - 2 недели`);
}

module.exports = {
    // Основная функция для получения календаря двух недель
    getCalendar,
    
    // Вспомогательные функции (экспортируем на случай если понадобятся)
    createICSCalendar,
    createICSEvent,
    formatDateForICS
}