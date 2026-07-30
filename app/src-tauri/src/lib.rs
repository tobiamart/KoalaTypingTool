/// Włącza natywny sprawdzacz pisowni webview na macOS.
///
/// W osadzonym WKWebView ciągłe sprawdzanie pisowni jest domyślnie **wyłączone**:
/// WebKit trzyma ten stan w NSUserDefaults pod kluczem
/// `WebContinuousSpellCheckingEnabled`, a `boolForKey:` przy braku klucza zwraca
/// `NO`. Sam atrybut `spellcheck` w HTML (`editorProps` w `Editor.tsx`) nic wtedy
/// nie daje — Safari pokazuje falki tylko dlatego, że sam zapisuje ten klucz.
///
/// Używamy `registerDefaults:`, a nie `setBool:forKey:`: wpis trafia do domeny
/// rejestracyjnej, która nie jest zapisywana na dysk i ma najniższy priorytet
/// w liście przeszukiwania. Dzięki temu nie zaśmiecamy preferencji użytkownika
/// i nie nadpisujemy jego decyzji, jeśli sam wyłączy sprawdzanie z menu
/// kontekstowego edytora.
#[cfg(target_os = "macos")]
fn register_spellcheck_defaults() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    let yes = NSNumber::new_bool(true);
    let continuous = NSString::from_str("WebContinuousSpellCheckingEnabled");
    let grammar = NSString::from_str("WebGrammarCheckingEnabled");

    let keys: [&NSString; 2] = [&continuous, &grammar];
    let values: [&AnyObject; 2] = [&yes, &yes];
    let defaults = NSDictionary::<NSString, AnyObject>::from_slices(&keys, &values);

    // SAFETY: słownik ma typy wymagane przez registerDefaults: (NSString → obiekt).
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults) };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Musi być przed utworzeniem okna — WebKit czyta ten stan przy pierwszym użyciu.
    #[cfg(target_os = "macos")]
    register_spellcheck_defaults();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
