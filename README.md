# VINA DRAGON - Bản chuẩn GitHub & Vercel

Thư mục này đã được chuyển đổi hoàn toàn từ Google Apps Script sang chuẩn Web + Serverless API của **Vercel**.

## Cấu trúc thư mục
- `index.html`: Màn hình trình chiếu chính (`Main`).
- `admin.html`: Bảng điều khiển quản trị (`Admin`).
- `styles.css`: Giao diện và hiệu ứng trình chiếu.
- `core.js`: Động cơ Vòng quay & Quản lý đồng bộ.
- `gas-shim.js`: Cầu nối giả lập `google.script.run` gọi tới `/api/rpc` và đồng bộ `localStorage`.
- `api/rpc.js`: Vercel Serverless API xử lý đồng bộ trạng thái giữa Điện thoại (Admin) và Máy chiếu (Main).
- `bgm.mp3`: File nhạc nền tích hợp trực tiếp trong dự án.
- `vercel.json`: Cấu hình đường dẫn của Vercel.

---

## Cách đưa lên GitHub và chạy trên Vercel

### Bước 1: Đẩy thư mục `vercel-app` lên GitHub
Mở Terminal / PowerShell tại thư mục `vercel-app`:
```powershell
cd c:\Users\ADMIN\.gemini\antigravity\scratch\tatnien\vercel-app
git init
git add .
git commit -m "Deploy Vina Dragon Event to Vercel"
git branch -M main
git remote add origin https://github.com/<TEN_TAI_KHOAN_CUA_BAN>/<TEN_REPO>.git
git push -u origin main
```

### Bước 2: Triển khai trên Vercel
1. Truy cập [https://vercel.com](https://vercel.com) và đăng nhập bằng tài khoản GitHub.
2. Nhấn **Add New... -> Project** và chọn Repository bạn vừa đẩy lên.
3. Nhấn **Deploy** (giữ nguyên cấu hình mặc định).

### Bước 3: Đường dẫn sử dụng sau khi Deploy
- **Màn hình trình chiếu (Main)**: `https://<ten-du-an>.vercel.app/`
- **Màn hình điều khiển (Admin)**: `https://<ten-du-an>.vercel.app/admin` (hoặc `https://<ten-du-an>.vercel.app/?page=admin`)
