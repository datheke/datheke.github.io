# Arreglos a plugins de Tauri para Android (se aplican en GitHub Actions, sobre el código bajado por cargo).
#  1. sharekit viene con compileSdk 35 y las librerías de Tauri piden 36.
#  2. notification: con la app cerrada, tocar "Posponer" o "Hecho" en la notificación abre la app y el aviso del botón
#     llega antes de que la página lo escuche (se perdía y no se posponía). Se repite a los 2,5 y 6 segundos;
#     notify.ts lo atiende una sola vez.
import glob, os, re, sys

home = os.path.expanduser('~/.cargo/registry/src')
ok = True

for f in glob.glob(f'{home}/*/tauri-plugin-sharekit-*/android/build.gradle.kts'):
    s = open(f).read()
    open(f, 'w').write(re.sub(r'compileSdk = \d+', 'compileSdk = 36', s))
    print('sharekit compileSdk 36:', f)

OLD = '''    val intent = activity.intent
    intent?.let {
      onIntent(it)
    }'''
NEW = '''    val intent = activity.intent
    intent?.let {
      onIntent(it)
      // Datheke: la página aún no escucha cuando la app recién se abre: se repite y luego se marca como atendido.
      val h = android.os.Handler(android.os.Looper.getMainLooper())
      h.postDelayed({ onIntent(it) }, 2500)
      h.postDelayed({ onIntent(it); it.action = "datheke.atendido" }, 6000)
    }'''
files = glob.glob(f'{home}/*/tauri-plugin-notification-*/android/src/main/java/NotificationPlugin.kt')
if not files: ok = False; print('No se encontró NotificationPlugin.kt')
for f in files:
    s = open(f).read()
    if 'datheke.atendido' in s: print('ya parchado:', f); continue
    if OLD not in s: ok = False; print('No se pudo parchar:', f); continue
    open(f, 'w').write(s.replace(OLD, NEW))
    print('notification parchado:', f)

sys.exit(0 if ok else 1)
