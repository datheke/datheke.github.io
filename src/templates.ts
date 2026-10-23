// Plantillas incluidas. Las del usuario son las notas de la libreta marcada como "Plantillas".
const task = (n: number) => `<ul data-type="taskList">${'<li data-type="taskItem" data-checked="false"><p></p></li>'.repeat(n)}</ul>`

export const TEMPLATES = [
  { title: 'Lista de compras', html: `<h2>🛒 Lista de compras</h2>${task(5)}` },
  { title: 'Reunión', html: '<p><strong>Fecha:</strong> </p><p><strong>Asistentes:</strong> </p><h3>Temas</h3><ul><li><p></p></li></ul>'
    + `<h3>Acuerdos y tareas</h3>${task(3)}` },
  { title: 'Diario', html: '<p><strong>Hoy agradezco:</strong> </p><p><strong>Lo mejor del día:</strong> </p><p><strong>Para mañana:</strong> </p>' },
  { title: 'Pendientes', html: `<h3>🔴 Urgente</h3>${task(2)}<h3>🟡 Esta semana</h3>${task(2)}<h3>🟢 Algún día</h3>${task(2)}` },
]
