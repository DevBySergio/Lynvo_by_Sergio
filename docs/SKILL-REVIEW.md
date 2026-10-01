# Revisión de la SKILL de Lynvo

Esta revisión evalúa las instrucciones de la SKILL embebida para que un agente pueda gestionar un tablero existente con criterio, reutilizar trabajo y mantener sus datos. Describe mejoras documentales y límites del producto; no propone funcionalidades nuevas de la extensión ni cambios del esquema o de las rutas del tablero.

La referencia es la versión anterior de `SKILL.md`, con 835 líneas, del commit `5300d5b`, cuyo SHA-256 es `9772e57e2b5643adff193e49e00fa5f1df2c5146fd70b155a6861843ec6edcc9`. Las líneas citadas en los hallazgos corresponden a ese documento, no a la numeración de su reescritura. El contraste se ha realizado por lectura de los tipos, la validación, la persistencia, la sincronización y la interfaz actuales. Las mejoras aplicadas y sus comprobaciones se detallan al final; los hallazgos describen el estado anterior.

## Diagnóstico

La SKILL anterior recoge buena parte del modelo de datos y de la interfaz, pero da prioridad a describir funciones frente a decidir cómo usarlas. Sus reglas de ejecución obligan a crear un plan y después tarjetas de implementación aunque el tablero ya tenga ese trabajo. La búsqueda de tareas existentes aparece como recomendación para las relaciones, no como condición previa a la creación. Repetir una solicitud puede producir nuevas tarjetas, checklists y relaciones para el mismo resultado.

También contiene políticas que sustituyen decisiones del proyecto por heurísticas generales: avanzar al estado situado más a la derecha, elegir siempre la mayor prioridad o conservar la fecha más próxima. Estas decisiones pueden borrar una corrección intencionada o dar por completado trabajo pendiente. La nueva SKILL debe basarse en el alcance solicitado, el inventario real y la evidencia de ejecución.

La mejora principal es un flujo operativo reutilizable: seleccionar el proyecto, leer el tablero, decidir entre reutilizar, ampliar o crear, aplicar cambios mínimos, verificar su persistencia y comunicar el estado real de la sincronización. Las referencias técnicas deben apoyar ese flujo y distinguir una función disponible en la interfaz de una API accesible al agente.

## Hallazgos priorizados

Las prioridades siguientes corresponden al riesgo de las instrucciones, no a una clasificación de bugs nuevos del producto.

| Prioridad | Referencia anterior | Riesgo concreto | Cambio requerido |
|---|---|---|---|
| P0 | `Autonomous Task Workflow`, líneas 680 y 786 | Cada petición con varios pasos crea un plan nuevo, incluso si ya existe una tarea adecuada. La fase de implementación añade después más tarjetas para el mismo trabajo. | Inventariar y buscar antes de crear. Reutilizar la tarea existente; ampliar su checklist cuando el alcance sea el mismo. Crear una tarjeta de coordinación solo si aporta seguimiento propio. |
| P0 | `Phase 4: Completion`, líneas 778–781; regla 794 | La orden de mover todas las tareas y marcar toda la checklist como completada contradice la obligación de verificar cada resultado. Un cierre parcial o un error puede terminar registrado como `done`. | Cerrar únicamente resultados comprobados. Mantener pendientes los pasos no ejecutados, bloqueados o fallidos y explicar la evidencia y las limitaciones. |
| P0 | Política de conflictos, líneas 548–550 y 552 | El orden de columnas no mide progreso; una columna `Blocked` puede estar a la derecha. Una prioridad menor, una fecha eliminada o un texto vacío pueden ser cambios intencionados. Elegir automáticamente el valor más avanzado, urgente o no vacío pierde esa intención. | Resolver por una política indicada por el usuario o por evidencia suficiente del caso. Conservar un conflicto ambiguo y continuar el trabajo independiente; no inventar finalización, urgencia o compromisos. |
| P0 | Ejemplo de `sync.json`, líneas 374–384 | El texto pide preservar la base de sincronización, pero el ejemplo reemplaza `lastRemoteCommit` y `lastSyncAt` por `null`. Copiarlo elimina información necesaria para el merge de tres vías. | Mostrar un parche del objeto leído, conservando la base y los campos no afectados. Marcar pendiente sin declarar una sincronización realizada ni borrar conflictos. |
| P1 | Plan de ejemplo, líneas 684–700 | El bloque se etiqueta como JSON, pero contiene `<now>` y repite `check-{id}` para cinco elementos. Una copia literal es inválida o genera IDs de checklist duplicados. | Ofrecer ejemplos construidos con IDs distintos y timestamps reales, o identificar claramente el pseudocódigo. Comprobar unicidad antes de escribir. |
| P1 | Ejemplo de tarea, líneas 319–348 | Los mismos pasos aparecen como casillas Markdown en la descripción y como checklist nativa, con contenidos diferentes. Ambas representaciones pueden divergir. Además, la fecha fija de 2024 y las referencias inventadas quedan desactualizadas al copiar. | Una sola fuente de progreso en `checklist`; contexto y criterios en `description`. Derivar fechas y referencias del trabajo real, y omitirlas cuando no existan. |
| P1 | Estado y etiquetas de los ejemplos, líneas 321, 333, 687, 748, 754–755 y 769–781 | Se asume que existen `todo`, `in-progress`, `done` y `feat`; también se asigna `high` a toda implementación. En un tablero personalizado se puede usar un estado inexistente, dejar una etiqueta colgante o alterar la priorización. | Construir un mapa con los IDs reales de columnas y etiquetas. Conservar la prioridad existente salvo una razón concreta para cambiarla. Crear solo las categorías y estados necesarios. |
| P1 | Recetas directas, líneas 388–405 | La lista no cubre editar/reordenar/eliminar columnas, eliminar etiquetas y sus referencias, ni resolver lotes de conflictos con snapshots. `Add relation` omite actualizar timestamp y actor de la tarea origen. | Incluir una matriz de operaciones con todos sus archivos, referencias, tombstones y efectos laterales. No presentar una escritura aislada como una operación completa. |
| P1 | Comandos y protocolo, líneas 283–299 y 613–648; regla 799 | El protocolo interno de la webview puede interpretarse como una API pública. Los comandos de creación reales abren diálogos y no ofrecen CRUD automatizable mediante los payloads de la tabla. | Separar herramientas realmente disponibles, comandos interactivos y protocolo interno. Usar la vía accesible en la sesión; no inventar comandos, conectores o acceso al panel. |
| P1 | Recetas de lectura/escritura y regla 796 | Serializar las operaciones de un script externo no lo incorpora a la cola de la extensión. Leer una vez y reescribir objetos completos puede sobrescribir cambios hechos por otra ventana, un usuario o la sincronización. | Volver a leer y comparar las entidades y metadatos afectados antes de aplicar el parche. Recalcular tras cambios concurrentes; preferir la vía nativa disponible. Reconocer que varios JSON no constituyen una transacción atómica. |
| P1 | Ámbito de uso y ejemplos relativos, líneas 11–16 y 301–405 | No hay un paso explícito de selección de workspace. En un proyecto multirraíz, el directorio de ejecución, el editor activo y el tablero mostrado pueden pertenecer a carpetas diferentes. | Fijar la raíz del proyecto antes de leer o escribir y comprobar que las operaciones siguen dirigidas a ella. No inicializar un tablero en otra carpeta para completar una inspección. |
| P1 | Política de descripción, líneas 547 y 552 | Elegir el texto más largo o unir ambos lados puede restaurar información eliminada deliberadamente o combinar requisitos incompatibles. | Mantener cambios independientes solo cuando se conozca su intención y no se contradigan. No tratar longitud, inclusión textual o ausencia de contenido como prueba suficiente. |
| P2 | Reutilización de columnas/etiquetas, líneas 470–488 | Igualar nombres por mayúsculas y puntuación no detecta equivalencias de idioma o significado. Exigir dos tareas para una etiqueta puede impedir una categoría útil desde su primera aparición. | Buscar equivalencia semántica y mantener la taxonomía del proyecto. Crear una categoría estable cuando sea necesaria, sin añadir una paleta completa ni un umbral rígido. |
| P2 | Descripción de tipos y defaults, líneas 81 y 266–281 | Se afirma que `position` se rellena con `createdAt`; el campo puede permanecer ausente y la interfaz usa `createdAt` como alternativa de ordenación. El alias de valores de conflicto usa `CodeReference` sin definirlo como tipo independiente en ese bloque. | Distinguir valores persistidos de alternativas de visualización. Si se ofrecen tipos completos, deben ser autosuficientes y coherentes con `src/types.ts`. |
| P2 | Sync y Activity, líneas 496, 518, 527, 576 y 662 | Se generaliza el debounce a cualquier edición, los conflictos a tareas y el feed a todos los cambios. También se describe una limpieza genérica de archivos huérfanos que podría justificar borrar archivos ajenos. | Aclarar los disparadores reales, las tres entidades de conflicto y el límite de 500 eventos. No ordenar purgas ni inferir archivos prescindibles por ausencia en un snapshot antiguo. |

## Flujo profesional recomendado

### 1. Confirmar el alcance y localizar el tablero

Identificar la raíz solicitada y leer los archivos modulares existentes. Si la petición es una inspección, no debe convertirse en una reorganización o en una creación masiva de tareas. Trabajar en el código de la extensión Lynvo tampoco significa que el usuario haya pedido crear tarjetas en cualquier tablero que el agente encuentre.

La gestión rutinaria de tareas, columnas o etiquetas necesarias debe avanzar cuando ya está incluida en la solicitud. Una política específica de un proyecto solo se aplica si el usuario o las instrucciones reales de ese proyecto la han establecido. La SKILL general no debe exigir gates, jerarquías, IDs, aprobaciones por tarjeta ni un patrón de detenerse después de cada tarea.

### 2. Construir un inventario suficiente

Leer columnas y etiquetas, todas las tareas relevantes —incluidas las completadas—, relaciones, tombstones, conflictos y metadatos de sync. Anotar IDs existentes, alcance y estado de cada candidato. Para tableros grandes se puede hacer una búsqueda inicial por título y después inspeccionar los candidatos completos; un filtro de la interfaz no demuestra que una tarea no exista.

Antes de modificar, comprobar si hay datos corruptos, un esquema no admitido o una operación de sincronización en curso que afecte a esos archivos. Un error de carga requiere conservar los archivos y explicar el problema; no permite reemplazar el tablero por defaults ni recuperar silenciosamente una copia legacy.

### 3. Decidir entre reutilizar, ampliar y crear

Comparar el resultado esperado, el área funcional, el alcance, los criterios de aceptación, las referencias de código y las relaciones, no solo el título. Dos tareas con nombres diferentes pueden cubrir el mismo resultado; dos títulos parecidos pueden cubrir plataformas o fases distintas.

| Situación observada | Acción |
|---|---|
| Existe una tarea abierta con el mismo resultado y alcance | Reutilizar su ID y actualizar solo lo necesario. |
| El resultado ya está completado y sigue siendo válido | No crear otra implementación del mismo resultado. Registrar una verificación nueva solo si se pidió y aporta seguimiento independiente. |
| Existe una tarea que cubre el resultado, pero falta un criterio o un paso pequeño | Ampliar su descripción o checklist sin borrar progreso válido. |
| La petición es una regresión, una nueva plataforma o una ampliación independiente | Crear una tarea con el alcance diferencial explícito y una relación pertinente. |
| Hay dos tarjetas equivalentes existentes | Señalar la equivalencia y elegir una referencia canónica para el trabajo. No borrar ni fusionar historial sin un alcance de consolidación autorizado. |
| No existe una tarea adecuada | Crear una tarjeta nueva con metadatos reales. |

Repetir la misma petición debe terminar reutilizando los mismos IDs. La relación `duplicates` documenta una duplicación existente; no sustituye la prevención de crear otra tarjeta. Una comprobación final del inventario antes de guardar reduce duplicados si otro agente ha creado el trabajo mientras se preparaba el cambio.

### 4. Usar una taxonomía mínima y coherente

Las columnas representan estados del flujo, no categorías de trabajo, epígrafes del plan o componentes. Las etiquetas representan categorías estables. Reutilizar primero equivalentes como `Bug`, `Errores` y `Defect` cuando su significado en ese proyecto sea el mismo.

Crear una columna si el trabajo necesita un estado operativo que no existe, como una revisión real o un bloqueo visible. Crear una etiqueta si una categoría útil no existe. Estas operaciones forman parte de una gestión ya autorizada; no necesitan una confirmación adicional por defecto. Evitar renombrar o recolorear categorías existentes por gusto del agente. Mantener un orden determinista y usar los IDs reales en las tareas.

Una columna nueva no adquiere semántica nativa de “completada” por situarla a la derecha o llamarla `Terminado`. La planificación debe conocer el flujo del proyecto y la SKILL debe explicar los límites de las métricas actuales.

### 5. Planificar con proporcionalidad y campos nativos

Un trabajo acotado puede ser una tarea con checklist. Las tarjetas separadas se justifican por resultados independientes, dependencias, seguimiento o prioridades diferentes. Un plan coordinador es opcional y debe aportar valor propio; la relación `related` no crea una jerarquía padre/hijo.

Usar `labelIds`, `priority`, `status`, `dueDate`, `codeReference`, `checklist` y `relations` como datos nativos. La descripción contiene contexto, alcance, criterios y enlaces de evidencia; no debe repetir una segunda checklist de progreso ni copiar estos metadatos como una tabla paralela. Identificar los elementos de checklist por su ID, no por un texto que puede repetirse o cambiar.

No inventar fechas. Si existe un compromiso, convertirlo a milisegundos usando la zona horaria y la precisión conocidas. No asignar una prioridad alta a todas las tarjetas. Conservar `createdBy` y `createdAt` al editar y usar un actor de agente honesto cuando no haya identidad autenticada disponible.

### 6. Construir relaciones reales

Añadir una dependencia solo cuando un resultado sea requisito para el siguiente. Compartir un archivo no demuestra un bloqueo; puede justificar `related` si aporta contexto. Comprobar que ambos IDs existen, que no hay autorrelación, que no existe ya la misma relación y que no se introduce un ciclo de dependencias.

Interpretar correctamente `blocks` y `blocked-by`: `A blocks B` y `B blocked-by A` expresan la misma dependencia lógica. No crear ambas automáticamente para conseguir “bidireccionalidad”. La interfaz almacena relaciones dirigidas en la tarea origen; no hay un motor que ejecute, desbloquee o cambie estados automáticamente a partir de ellas.

### 7. Aplicar cambios mínimos y preservar datos

Elegir una herramienta o vía realmente disponible. Un comando interactivo no equivale a una API de escritura parametrizada. Cuando sea necesaria la edición directa, leer objetos completos pero parchear solo los campos solicitados, conservando campos ajenos y ficheros existentes.

Usar IDs únicos y seguros para el sistema de archivos, respetar los IDs humanos existentes y conservar la ruta real de los archivos ya presentes. No cambiar rutas, esquema `2.0.0`, formato modular, `settings.json` o directorios reservados. Generar JSON válido y escribir cada archivo con sustitución atómica cuando sea posible. No presentar una secuencia de sustituciones de varios archivos como una transacción indivisible.

Comparar el estado recién leído con el usado para preparar el cambio. Si cambió una entidad o un conflicto, rebasar el parche o revisar el nuevo estado. Para las tareas modificadas, actualizar `lastModifiedBy` y un `updatedAt` creciente; el backend usa `max(Date.now(), previousUpdatedAt + 1)`. En checklist, actualizar también el timestamp del elemento afectado. Las operaciones directas requieren las mismas actualizaciones de referencias y tombstones que su equivalente nativo.

Los eventos deben describir cambios reales con los tipos existentes. No hay tipos `label_updated`, `column_reordered` o `conflict_resolved`; el reordenado de columnas nativo no genera un evento. La recomendación general de registrar actividad no autoriza a inventar eventos del esquema.

### 8. Verificar progreso y sincronización por separado

Leer de nuevo los archivos afectados para comprobar que los IDs, valores, relaciones y referencias esperados persisten. La escritura correcta de una tarjeta no acredita que el trabajo funcional esté completo. Registrar la evidencia pertinente antes de moverla a un estado completado y conservar pendientes los criterios no satisfechos.

Conservar `lastRemoteCommit`, `lastSyncAt` y los campos no afectados al marcar cambios locales como pendientes. No poner `synced` para representar que un script terminó. Usar la sincronización nativa cuando esté disponible y configurada, y volver a leer su resultado: un push realizado puede coexistir con cambios posteriores todavía pendientes o con conflictos.

El resultado final debe distinguir tareas reutilizadas y creadas, cambios aplicados, evidencia de trabajo completado, pendientes y estado observado de sync. Un error de red no invalida por sí mismo una escritura local correcta.

## Cobertura de operaciones que debe tener la nueva SKILL

Estas recetas documentan efectos ya existentes. No implican añadir endpoints, herramientas ni nuevos archivos del tablero.

| Operación | Comportamiento que debe explicarse |
|---|---|
| Crear o editar tarea | Selección de estado y etiquetas existentes; preservar autor/fecha originales; parche mínimo; timestamps/actor; actividad válida; pending de sync. |
| Mover o reordenar tareas | `status` referencia una columna real; `position` es numérico; actualizar tareas afectadas. La posición de una tarjeta no mide prioridad ni finalización. |
| Checklist | Crear IDs únicos; editar por ID; diferenciar texto y progreso; preservar elementos no afectados y su estado; actualizar elemento y tarea. |
| Relaciones | Comprobar origen/destino; evitar relaciones repetidas o semánticamente redundantes; timestamps/actor en origen; limpiar referencias al borrar tareas. |
| Crear o editar columna | Reutilización previa; campos `title`, `color`, `position`; no cambiar el ID para renombrarla; eventos admitidos. |
| Reordenar columnas | Orden numérico determinista; no modificar estados de tareas ni asumir un avance del trabajo; no inventar actividad de reordenado. |
| Eliminar columna | La operación nativa elimina todas sus tareas, añade tombstones de columna y tareas, y limpia relaciones supervivientes. No se permite borrar la última columna. Reorganizar no equivale a autorizar ese borrado. |
| Crear etiqueta | Reutilización semántica; registro en `board.json.labels`; ID real en las tareas; `label_created`. |
| Renombrar o recolorear etiqueta | El esquema admite `name` y `color`, pero la interfaz y el protocolo actual no tienen operación de edición. Una modificación directa debe preservar ID y referencias; no existe `label_updated`. |
| Eliminar etiqueta | Tombstone de etiqueta, retirada del ID en tareas afectadas, timestamps/actor de esas tareas y `label_deleted`. |
| Eliminar tarea | Tombstone de tarea, limpieza de relaciones que la apuntan, timestamps/actor de las tareas afectadas y `task_deleted`. No basta con eliminar el JSON. |
| Quitar fecha o referencia de código | Documentar la representación compatible del campo opcional, conservando el resto; no dejar un objeto de referencia parcial ni usar una fecha ficticia. |
| Resolver un conflicto | Entidades `task`, `column` y `label`, campo y tipo correctos, snapshot leído y valor actual. Conservar un cambio que apareció después de la revisión. |
| Resolver todos los conflictos | `Keep all` conserva valores locales; `Discard all` aplica valores remotos revisados. La vía nativa valida el lote antes de aplicarlo. Una receta de JSON externo no puede prometer esa atomicidad entre archivos. |
| Sincronizar | Comando real y configuración existente; no hacer push forzado, no tocar la rama de código ni falsificar el resultado en `sync.json`. |

## Capacidades y límites reales

### Acceso del agente

Los comandos públicos registrados incluyen abrir las seis vistas, `lynvo.quickCreateTask`, `lynvo.createTaskFromCode`, `lynvo.syncBoard`, conexión GitHub e instalación de skills. Los dos comandos de creación son interactivos. No existe un comando público `lynvo.createTask` que acepte el payload del protocolo de la webview.

La tabla de mensajes describe la comunicación entre `App.tsx` y `LynvoPanel.ts`, no un conector, MCP o CLI público. La disponibilidad de una herramienta debe comprobarse en la sesión. La SKILL instalada debe ser autosuficiente: `SkillInstaller` distribuye el documento de la skill, por lo que no puede exigir scripts o recursos adicionales del repositorio que no se instalan con ella.

La selección de workspace puede depender de la carpeta del editor activo y del contexto seleccionado. Los comandos de apertura preparan el workspace y pueden inicializar un tablero ausente; no son una garantía de inspección sin efectos. La edición directa debe dirigirse a una raíz inequívoca.

### Esquema y campos

El esquema vigente es `2.0.0`. Una tarea no tiene campos nativos de asignación, estimación, sprint, padre/hijo, WIP ni coordenadas del mapa. `createdBy` y `lastModifiedBy` son atribución de autoría, no responsables de ejecución. `users.json` registra presencia; no es un catálogo de asignaciones. `comments/` está reservado y no ofrece una función actual de comentarios.

Los registros de tarea y actividad se respaldan con archivos cuyo nombre depende del ID. La validación admite IDs existentes seguros, pero rechaza rutas, controles, nombres reservados y Unicode que no se pueda convertir a UTF-8 y recuperar sin cambios. Sus IDs deben caber en 240 bytes UTF-8 y no colisionar ignorando mayúsculas y normalizando Unicode; los demás IDs tienen también restricciones y un límite general de 1024 unidades UTF-16. Esto no justifica renumerar tarjetas existentes ni imponerles IDs sintéticos nuevos.

Las rutas y campos opcionales deben conservarse. En particular, `position` puede faltar: la interfaz usa `createdAt` como alternativa para ordenar tarjetas, sin que el campo se escriba necesariamente. Los datos inválidos no autorizan al agente a regenerar un tablero vacío. La presencia de archivos modulares bloquea un fallback automático al archivo legacy, incluso si están dañados. Las copias `.corrupt-*` ayudan a una recuperación manual, no constituyen una recuperación automática garantizada.

Una lectura conserva referencias a etiquetas o tareas ausentes en ese snapshot. Detectar una referencia colgante sirve para investigar, no autoriza a borrarla durante una edición ajena. La limpieza de referencias es parte de una eliminación o reparación concreta, con un inventario completo y un alcance establecido.

### Interfaz y presentación

| Área | Disponible | Límite que debe quedar explícito |
|---|---|---|
| Board | Drag-and-drop de tareas, editor, checklist, relaciones, columnas y filtros | Las columnas se reordenan con botones. Guardar confirma el borrador del editor; cancelar conserva el tablero anterior. Los controles de una tarjeta fuera del editor pueden aplicar cambios directamente. |
| Checklist de tarjeta | Expandir elementos ocultos y volver a colapsar | Esa expansión es estado de la interfaz; no es un nuevo campo de tarea. |
| Table | Filas y mapa de relaciones | Las filas se ordenan por `updatedAt` descendente; las cabeceras no cambian el orden. No es una hoja de cálculo con ordenación arbitraria. |
| Map | Layout por estado, arrastre visual, líneas, zoom, pan, Fit y detalle | Mover nodos no mueve tareas de columna ni persiste coordenadas en el tablero. Las relaciones son datos; el layout es presentación. |
| Labels | Crear y eliminar | No hay edición de nombre/color en la UI ni mensaje público de edición. |
| Activity | Feed cronológico | Solo se conservan los 500 eventos más recientes. No es un historial completo ni una fuente para recuperar todo el tablero. |
| Conflicts | Resolución local/remota individual y botones para el lote | `Discard all` acepta la versión remota, no elimina tarjetas. Elegir un lado no prueba que su contenido sea correcto. |
| Insights | Total, completadas, porcentaje, vencidas, sin actividad e iniciadas | Las métricas siguen la identificación de columnas implementada, no una semántica configurable por columna. |
| Descripción | Subconjunto de Markdown: listas, casillas, citas, bloques de código, código inline y enlaces | No se debe prometer Markdown completo. Las casillas en la descripción no son la checklist nativa ni actualizan su progreso. |
| Referencia de código | Ruta relativa y líneas, navegación al archivo | La apertura usa `lineStart`; no hay garantía de seleccionar o resaltar todo `lineStart`–`lineEnd`. |
| Estado del panel | Contexto al ocultarlo y borrador en el estado de la misma webview | No se promete recuperación tras cerrar explícitamente el panel o reiniciar VS Code. |

En las métricas, el ID `done` identifica completadas aunque se renombre su título. Solo si no existe ese ID se usa un título que contenga `done`. Para trabajo iniciado se prioriza el ID `in-progress` y, si falta, un título que contenga `progress`. Las tareas completadas quedan fuera de vencidas y sin actividad; esta última cuenta tareas con más de siete días sin actualizar. Un estado personalizado en otro idioma puede no ser reconocido por esas métricas. La SKILL debe explicar este límite en vez de inferir que cualquier columna final funciona igual.

### Sincronización y concurrencia

El sync usa la rama `lynvo-sync`, un worktree temporal y merge por campo con la base Git conocida. También contempla conflictos de columnas y etiquetas, no solo de texto de tareas. El debounce de 15 segundos se programa desde las mutaciones nativas; el watcher de JSON externos refresca la interfaz y no programa por sí mismo ese debounce. Las ediciones directas dependen del sync periódico o manual disponible, no de una garantía de push a los 15 segundos.

La exclusión mediante `.git/info/exclude` evita añadir archivos no versionados desde el worktree de código. No saca del índice archivos que ya estuvieran versionados, y la implementación actual no rechaza ese caso. La documentación no debe prometer aislamiento absoluto ni ejecutar `git rm` como efecto automático de gestionar un tablero.

La cola de persistencia y los locks temporales coordinan mutaciones nativas; un escritor externo no participa automáticamente en ellos. La sustitución atómica de un archivo evita JSON parcial, pero no hace atómico el conjunto de tarea, actividad, tombstone y metadatos. Es necesario describir esta limitación y minimizar escrituras concurrentes, sin añadir locks o recursos nuevos dentro del tablero.

## Criterios para revisar la reescritura

La nueva SKILL debería empezar por el flujo de gestión y ofrecer después el modelo y las recetas. La referencia de mensajes puede abreviarse o marcarse claramente como interna; las funciones deben ser localizables sin obligar al lector a atravesar un bloque extenso de tipos para decidir si debe crear una tarjeta.

Las reglas generales deben ser coherentes con sus ejemplos. Ningún ejemplo debe crear por defecto un plan, copiar IDs, inventar una fecha, usar etiquetas ausentes, duplicar progreso en Markdown o resetear la base de sync. Tampoco debe imponer permisos adicionales para cambios rutinarios ya solicitados ni políticas específicas de un proyecto ajeno.

Los siguientes criterios guiaron la reescritura. La sección de validación distingue las comprobaciones ejecutadas del alcance que cubren:

1. Pedir dos veces la misma planificación reutiliza tareas, columnas, etiquetas y relaciones existentes.
2. Una tarea existente con alcance parcial se amplía sin perder checklist completada, autoría ni campos ajenos.
3. Una tarea completada no genera otra implementación idéntica; una regresión sí puede tener una tarjeta con alcance nuevo explícito.
4. Nombres equivalentes de columnas y etiquetas se reutilizan sin cambiar su ID o su semántica.
5. Un lote con un paso fallido o no verificado no se cierra íntegramente como completado.
6. Un conflicto de estado, fecha borrada o prioridad reducida no se resuelve mediante una heurística que invente intención.
7. Un cambio concurrente obliga a volver a leer y revisar, y un lote nativo de conflictos utiliza los snapshots correctos.
8. Marcar pending conserva la base Git, timestamps de sync previos y cualquier conflicto todavía abierto.
9. Eliminar entidades reproduce tombstones y limpieza de referencias; reordenar o renombrar no se convierte en borrado.
10. Una edición normal mantiene rutas y esquema, preserva `settings.json`, no crea un board legacy y no cambia formato de IDs existentes.
11. La SKILL instalada contiene todo lo necesario para seguir sus instrucciones y no enlaza como requisito operativo scripts que no se distribuyen.
12. Las afirmaciones sobre UI, comandos, Markdown, métricas y sync coinciden con las capacidades anteriores.

## Mejoras aplicadas

La SKILL se ha reestructurado como una guía autosuficiente de operación. Pasa de 835 líneas a unas 290: el flujo de decisiones aparece primero; los campos, la persistencia y el protocolo quedan como referencia. Se conservan el nombre, la licencia y el uso automático de la skill, ampliando su descripción para cubrir auditoría y creación solicitada de tableros.

- **Planificación sin duplicados:** búsqueda semántica, reutilizar/ampliar/crear, revisión de trabajo completado, preservación de IDs y progreso, comprobación final tras cambios concurrentes y ausencia de cambios cuando la petición ya está cubierta. Se elimina la obligación de crear tarjetas “Plan:” y una falsa jerarquía.
- **Organización del flujo:** criterios para nuevas columnas, entrada/salida de QA/Review/Blocked, orden determinista, conservación de IDs de los estados predeterminados y traslado previo de tareas al consolidar columnas. Las etiquetas se crean por utilidad, también desde su primera aparición, sin repetir campos nativos ni imponer un catálogo fijo.
- **Más operaciones documentadas:** renombrar/recolorear etiquetas mediante JSON, consolidar etiquetas conservando asignaciones, reordenar/renombrar columnas sin perder tareas, eliminar con tombstones y limpiar referencias. Se distinguen las capacidades de la guía de las operaciones que aún no existen en la interfaz.
- **Ejecución verificable:** criterios de aceptación en la checklist nativa, actualización por ID, prioridades justificadas, fechas conocidas, referencias de código comprobadas y dependencias sin ciclos o aristas equivalentes. La finalización exige evidencia; no se cierran tareas automáticamente al terminar la sesión.
- **Escritura coordinada:** receta Node.js incluida en el propio documento, sin dependencias de scripts que el instalador no distribuye. Comparte el lock temporal del backend, conserva aliases del workspace, exige snapshots y sustituye archivos de forma atómica. Omite escrituras semánticamente iguales aunque cambie el orden de claves. El agente debe validar el lote y las rutas antes de escribir; la receta no es una transacción ni un validador completo.
- **Conflictos y sync:** decisiones basadas en elección del usuario, snapshots completos, alcance real de Keep all/Discard all, conservación de alternativas y actualización del valor local al editar un campo en conflicto. Los cambios locales mantienen la base Git y no se presentan como sincronizados. Se explican los tipos y las ausencias de campos sin inventar valores.
- **Instalación compatible:** el documento sigue siendo el único recurso operativo distribuido. No cambia el instalador, el esquema `2.0.0`, los directorios ni los campos del tablero; conserva instrucciones personalizadas.

## Validación realizada

Todas las operaciones de evaluación se realizaron en workspaces temporales. No se editaron tableros reales, instrucciones instaladas en HOME ni la copia personalizada de `.github/copilot-instructions.md` del proyecto.

| Comprobación | Resultado y alcance |
|---|---|
| Validador de `skill-creator` | `quick_validate.py` pasó: frontmatter, nombre y estructura válidos. No acredita decisiones de planificación por sí solo. |
| Evaluación de planificación por agente independiente | Se amplió una tarea existente de validación de correo conservando su checklist completada; se crearon tres resultados distintos, una columna QA antes de Done y dependencias sin ciclos. Reutilizó las etiquetas existentes y no tocó una guía ya completada. |
| Repetición de la planificación | Cero tareas, columnas, etiquetas, relaciones o eventos nuevos; todos los archivos del tablero conservaron exactamente sus bytes, incluidos timestamps y sync. |
| Conflictos con elección local explícita | Se resolvieron tres conflictos de estado, fecha y nombre de columna manteniendo los valores locales. La tarea siguió pendiente, se creó Accesibilidad y se añadió un criterio sin marcarlo completado. La repetición también fue un no-op. Este caso fue ejecutado y comprobado directamente, no por la evaluación independiente anterior. |
| Preservación en ambos escenarios | Se conservaron `lastRemoteCommit`, `lastSyncAt`, campos adicionales de sync, settings, tombstones, comentarios reservados, autoría original y datos no afectados. No apareció un archivo legacy ni se implementó el producto del fixture. |
| Primitivas instalables | `scripts/agent-skill-regression-test.js` ejecuta el bloque JavaScript extraído literalmente de `SKILL.md`: interoperabilidad con `BoardLock` y alias symlink, timeout sin borrar locks ajenos, liberación tras excepción, ownership cambiado, snapshots obsoletos, carreras de actualización/creación, no-op semántico, rechazo de archivos symlink y limpieza de temporales tras fallo. |
| Instalación del documento real | `scripts/skill-regression-test.js` verifica distribución completa de la SKILL actual, frontmatter/marcadores, actualización idempotente y conservación de instrucciones compartidas/personalizadas. |
| Regresiones del proyecto | `npm run check` pasó: TypeScript, ESLint, compilación, suites de persistencia/sync/instalación/UI/mapa/conflictos, nueva suite de la receta, smoke y build de producción. Tras añadir el caso del documento real, se volvió a ejecutar la suite del instalador y pasó. |
| Paquete de actualización | Se regeneró `lynvo-1.0.2.vsix` con `vsce package --no-dependencies`. Se comprobó que SKILL, manifest de paquete y bundles coinciden byte a byte con los archivos actuales. El paquete excluye tableros locales, instrucciones del proyecto, informes y scripts de pruebas. SHA-256 de la SKILL embebida: `136b92724d5b77c823a1459b97ffd8111d7373545c5f5dd0709aac8cfa49c507`. No se publicó en Marketplace. |

Las pruebas confirman estos casos concretos; no garantizan que cualquier agente detecte todas las equivalencias semánticas o cumpla las instrucciones en cualquier proyecto. La receta coordina escritores cooperativos del mismo host y temporal del sistema; no proporciona una transacción entre todos los JSON ni coordinación entre máquinas. No se han añadido UI de asignación, épicas, estimaciones, comentarios ni edición de etiquetas: se documentan como límites reales.

## Fuentes locales contrastadas

- `src/types.ts`: campos nativos, relaciones, eventos y conflictos admitidos.
- `src/boardValidation.ts`: normalización, IDs, campos opcionales y validación conservadora.
- `src/providers/DataManager.ts`: persistencia, timestamps, operaciones, tombstones, conflictos y efectos de eliminación.
- `src/providers/BoardLock.ts`: coordinación temporal entre operaciones de la extensión.
- `src/providers/GitService.ts`: base de merge, shadow branch, exclusión local y disparadores de sync.
- `src/providers/LynvoPanel.ts`: protocolo interno, confirmación de operaciones y navegación a código.
- `src/extension.ts`: comandos públicos, selección de workspace, inicialización y watcher externo.
- `src/webview/App.tsx` y `src/webview/mapLayout.ts`: edición, Markdown, vistas, mapa y métricas.
- `src/providers/SkillInstaller.ts`: distribución de la SKILL y preservación de instrucciones existentes.
