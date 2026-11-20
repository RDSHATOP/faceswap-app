// FaceSwap — Tauri-оболочка.
// Поднимает локальный сервер (node sidecar: server.js на 127.0.0.1:7100),
// показывает окно с веб-интерфейсом, при закрытии убивает всё дерево процессов
// (node + ComfyUI, который node мог запустить).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::TcpStream,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::Manager;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Дочерний процесс сервера (node.exe), живёт, пока живо приложение.
struct Sidecar {
    child: Arc<Mutex<Option<Child>>>,
}

/// Папка ресурсов: server.js, веб-интерфейс, (в установке) ComfyUI.
fn find_resources(exe: &PathBuf) -> PathBuf {
    // 1) Установленная копия: <app>\resources\
    if let Some(dir) = exe.parent() {
        let cand = dir.join("resources");
        if cand.join("server.js").exists() {
            return cand;
        }
    }
    // 2) Dev-запуск cargo: <repo>\target\<profile>\FaceSwap.exe → корень репо
    let mut p = exe.clone();
    for _ in 0..3 {
        if p.join("server.js").exists() {
            return p;
        }
        if !p.pop() {
            break;
        }
    }
    // 3) Текущая директория
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("server.js").exists() {
            return cwd;
        }
    }
    exe.parent()
        .map(|d| d.join("resources"))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn node_executable(exe: &PathBuf) -> PathBuf {
    // Рядом с приложением лежит node.exe (ставит установщик);
    // в dev-окружении — системный node из PATH.
    if let Some(dir) = exe.parent() {
        let bundled = dir.join("node.exe");
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from("node")
}

fn wait_for_port(addr: &str, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(addr).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(400));
    }
    false
}

/// taskkill /T убивает всё дерево: node и порождённый им ComfyUI.
fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn spawn_server(exe: &PathBuf, res: &PathBuf) -> Option<Child> {
    let data_dir = std::env::var("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("FaceSwap").join("data"))
        .unwrap_or_else(|_| res.join("data"));
    let _ = std::fs::create_dir_all(&data_dir);

    // Лог сайдкара — чтобы можно было диагностировать «из коробки»
    let log_file = std::fs::File::create(data_dir.join("sidecar.log")).ok();

    let mut cmd = Command::new(node_executable(exe));
    cmd.arg(res.join("server.js"))
        .args(["--host", "127.0.0.1", "--port", "7100"])
        .env("FACESWAP_DATA_DIR", &data_dir)
        .current_dir(res)
        .stdin(Stdio::null())
        .stdout(log_file.as_ref().and_then(|f| f.try_clone().ok()).map(Stdio::from).unwrap_or(Stdio::null()))
        .stderr(log_file.map(Stdio::from).unwrap_or(Stdio::null()))
        .creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(child) => Some(child),
        Err(e) => {
            eprintln!("[faceswap] не удалось запустить сервер: {e}");
            None
        }
    }
}

fn main() {
    let sidecar = Sidecar {
        child: Arc::new(Mutex::new(None)),
    };

    // Трассировка событий жизненного цикла — %LOCALAPPDATA%\FaceSwap\data\app.log
    let log_path = std::env::var("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("FaceSwap").join("data").join("app.log"))
        .ok();
    let trace = move |msg: &str| {
        if let Some(p) = &log_path {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
                let _ = writeln!(f, "{msg}");
            }
        }
    };

    tauri::Builder::default()
        .manage(sidecar.child.clone())
        .setup(move |app| {
            let exe = std::env::current_exe()?;
            let res = find_resources(&exe);
            eprintln!("[faceswap] ресурсы: {}", res.display());

            let child = spawn_server(&exe, &res);
            let pid = child.as_ref().map(|c| c.id());
            *app.state::<Arc<Mutex<Option<Child>>>>().lock().unwrap() = child;

            // Не показываем окно (conf-окно создаётся после setup), пока сервер не отвечает.
            if let Some(pid) = pid {
                if !wait_for_port("127.0.0.1:7100", Duration::from_secs(60)) {
                    eprintln!("[faceswap] сервер не поднялся за 60 с (pid {pid})");
                }
            } else {
                eprintln!("[faceswap] сервер не запущен — окно покажет ошибку подключения");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            let name = match &event {
                tauri::RunEvent::ExitRequested { .. } => "ExitRequested",
                tauri::RunEvent::Exit => "Exit",
                tauri::RunEvent::Ready => "Ready",
                tauri::RunEvent::Resumed => "Resumed",
                _ => "other",
            };
            trace(&format!("RunEvent: {name}"));
            if let tauri::RunEvent::Exit = event {
                let pid = app_handle
                    .state::<Arc<Mutex<Option<Child>>>>()
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|c| c.id());
                if let Some(pid) = pid {
                    trace(&format!("завершаю дерево сервера (pid {pid})"));
                    kill_tree(pid);
                    trace("дерево сервера завершено");
                }
            }
        });
}
