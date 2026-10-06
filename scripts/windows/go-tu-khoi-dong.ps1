# Gỡ tác vụ tự khởi động zalo-agent (đăng ký bởi cai-tu-khoi-dong.ps1) và dừng bot nếu đang chạy.
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows\go-tu-khoi-dong.ps1

$TenTacVu = "zalo-agent"
$tacVu = Get-ScheduledTask -TaskName $TenTacVu -ErrorAction SilentlyContinue
if (-not $tacVu) {
  Write-Host "Không có tác vụ '$TenTacVu' - không cần gỡ."
  exit 0
}
Stop-ScheduledTask -TaskName $TenTacVu -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TenTacVu -Confirm:$false
Write-Host "Đã gỡ tác vụ '$TenTacVu'. Nếu bot vẫn còn chạy, tắt tiến trình node đang giữ cổng 3900."
