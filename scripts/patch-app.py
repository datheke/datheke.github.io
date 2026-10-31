# Cambios al proyecto Android que genera Tauri (se aplican en GitHub Actions después de "tauri android init").
# Abrir con Datheke: un archivo .datheke tocado en WhatsApp, Descargas, correo… (o compartido a Datheke) se copia a
# cache/recibidas; la página lo encuentra ahí y pregunta en qué libreta agregarlo (share.ts: takeReceived).
import glob, sys

act = glob.glob('src-tauri/gen/android/app/src/main/java/**/MainActivity.kt', recursive=True)[0]
s = open(act).read()
CALL = 'super.onCreate(savedInstanceState)\n'
if CALL not in s: sys.exit('MainActivity: no se encontró onCreate')
# Teclado: con la app de borde a borde, el teclado tapaba lo de abajo de la nota. Se achica la página hasta el borde del
# teclado (menos la barra de navegación, que la página ya deja libre con safe-area-inset-bottom).
KEYBOARD = """    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { v, insets ->
      val ime = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime()).bottom
      val nav = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars()).bottom
      v.setPadding(0, 0, 0, maxOf(0, ime - nav))
      insets
    }
"""
s = s.replace(CALL, CALL + '    recibir(intent)\n' + KEYBOARD, 1)
METHODS = r'''
  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    recibir(intent)
  }

  private fun recibir(i: android.content.Intent?) {
    if (i == null) return
    val uri: android.net.Uri? = when (i.action) {
      android.content.Intent.ACTION_VIEW -> i.data
      android.content.Intent.ACTION_SEND -> i.getParcelableExtra<android.net.Uri>(android.content.Intent.EXTRA_STREAM)
      else -> null
    }
    if (uri == null) return
    try {
      var name = "nota.datheke"
      contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0)?.let { name = it }
      }
      val dir = java.io.File(cacheDir, "recibidas")
      dir.mkdirs()
      val safe = name.replace(Regex("[^\\p{L}\\p{N} ._()-]"), "-")
      contentResolver.openInputStream(uri)?.use { input ->
        java.io.File(dir, "${System.currentTimeMillis()}-$safe").outputStream().use { input.copyTo(it) }
      }
    } catch (e: Exception) {
      android.util.Log.e("Datheke", "No se pudo recibir el archivo", e)
    }
    i.action = "datheke.recibida"
  }

  // "Cambiar tono del aviso" (notify.ts): la página llama a DathekeAndroid.ajustesAviso().
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(DathekeAndroid(this), "DathekeAndroid")
  }
}

// Abre los ajustes del canal "Recordatorios" de Datheke: ahí se elige el tono, la vibración, etc.
class DathekeAndroid(private val a: android.app.Activity) {
  // "Regresar" desde Todas las notas: la app queda en segundo plano, como las demás (no se cierra del todo).
  @android.webkit.JavascriptInterface
  fun salir() {
    a.runOnUiThread { a.moveTaskToBack(true) }
  }

  @android.webkit.JavascriptInterface
  fun ajustesAviso() {
    a.runOnUiThread {
      try {
        val i = if (android.os.Build.VERSION.SDK_INT >= 26)
          android.content.Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, a.packageName)
            .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, "recordatorios")
        else
          android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + a.packageName))
        a.startActivity(i)
      } catch (e: Exception) {
        android.util.Log.e("Datheke", "No se pudieron abrir los ajustes del aviso", e)
      }
    }
  }
}
'''
end = s.rstrip().rfind('}')
s = s[:end].rstrip() + '\n' + METHODS
open(act, 'w').write(s)
print(s)

man = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'
m = open(man).read()
FILTERS = '''</intent-filter>
            <!-- Datheke: abrir o recibir un archivo .datheke (WhatsApp lo manda como archivo genérico). -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/zip" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/octet-stream" />
                <data android:mimeType="application/zip" />
            </intent-filter>'''
if '</intent-filter>' not in m: sys.exit('Manifest: no se encontró intent-filter')
m = m.replace('</intent-filter>', FILTERS, 1)
open(man, 'w').write(m)
print('Manifest con los filtros para .datheke')
