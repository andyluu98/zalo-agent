# Đăng ký zalo-agent tự chạy khi đăng nhập Windows (Task Scheduler, quyền người dùng thường).
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows\cai-tu-khoi-dong.ps1
#
# - Chạy ẩn cửa sổ, tự khởi động lại tối đa 5 lần (mỗi lần cách 1 phút) nếu tiến trình chết.
# - Log vẫn nằm ở data/logs như khi chạy tay.
# - Gỡ: scripts\windows\go-tu-khoi-dong.ps1
# - Đừng chạy thêm `pnpm start` bằng tay khi tác vụ này đang chạy: hai tiến trình sẽ tranh
#   cổng dashboard 3900 và tranh phiên Zalo của cùng một tài khoản.

$ErrorActionPreference = "Stop"
$TenTacVu = "zalo-agent"
$ThuMucRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source }
if (-not $pnpm) { throw "Không tìm thấy pnpm trong PATH. Chạy 'corepack enable' rồi thử lại." }
if (-not (Test-Path (Join-Path $ThuMucRepo ".env"))) { throw "Thiếu file .env trong $ThuMucRepo - làm theo mục Cài đặt trong README trước." }
if (-not (Test-Path (Join-Path $ThuMucRepo "web\dist\index.html"))) { Write-Warning "Chưa build dashboard: chạy 'pnpm build:web' một lần." }

$lenh = "Set-Location -LiteralPath '$ThuMucRepo'; & '$pnpm' start"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$lenh`"" `
  -WorkingDirectory $ThuMucRepo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Đợi 1 phút sau đăng nhập cho mạng kịp lên
$trigger.Delay = "PT1M"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TenTacVu -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description "zalo-agent ($ThuMucRepo) - tự chạy khi đăng nhập" -Force | Out-Null

Write-Host "Đã đăng ký tác vụ '$TenTacVu'. Bot sẽ tự chạy 1 phút sau mỗi lần đăng nhập Windows."
Write-Host "Chạy ngay không cần đăng xuất: Start-ScheduledTask -TaskName $TenTacVu"
