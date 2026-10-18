# SafeCheck - Token Safety Scanner

SafeCheck là công cụ quét an toàn token bảo mật onchain, hỗ trợ **Robinhood Chain**, **BNB Chain (BSC)**, **Ethereum (ETH)** và **Base**.

## Tính năng chính
- 🛡️ **Kiểm tra rủi ro**: Honeypot, Thuế mua/bán (Buy/Sell Tax), Mintable, Blacklist, Proxy/Upgradeable, Pausable, Hidden Owner, Anti-whale, Max Tx, Cooldown, Mô phỏng chuyển token (Transfer Simulation).
- 💧 **Thanh khoản & LP**: Kiểm tra Liquidity USD, tỷ lệ LP Burned / Locked, thông tin DEX pool.
- 👥 **Top Holders**: Phân bổ ví lớn nhất, nhận diện ví cá nhân (EOA), smart account (EIP-7702), ví Multisig (Safe), ví sàn, ví creator, pool thanh khoản, contract.
- 🔥 **Trending & Pool mới**: Bảng xếp hạng token trending và các pool mới tạo theo thời gian thực trên cả 4 mạng (Robinhood, BSC, Ethereum, Base).
- 🌐 **Social & Web Audit**: Phân tích tài khoản X (Twitter), bài đăng CA, thông tin website, SSL, domain age, kiểm tra CA trên website.
- 📤 **Chia sẻ**: Tạo thẻ báo cáo (Report Card) dạng ảnh tự động và chia sẻ trực tiếp lên X.
- 🌐 **Đa ngôn ngữ**: Tiếng Việt (VI), English (EN), 中文 (ZH) và Dark/Light mode.

---

## Cấu trúc thư mục
```
D:\Web\
├── index.html           # Frontend giao diện chính (SPA)
├── favicon.svg          # Logo favicon
├── dev_server.py        # Local Dev Server (chạy ngay bằng Python)
├── vercel.json          # Cấu hình deploy serverless Vercel
├── package.json         # Cấu hình project
├── assets/
│   ├── card.js          # Generator vẽ share card
│   ├── en.js            # Bản dịch tiếng Anh
│   └── zh.js            # Bản dịch tiếng Trung
└── api/
    ├── check.js         # API quét bảo mật token (/api/check)
    ├── trending.js      # API trending / pool mới (/api/trending)
    └── resolve.js       # API giải mã link pool sang CA (/api/resolve)
```

---

## Hướng dẫn chạy thử nghiệm tại máy (Local Dev)
Bạn chỉ cần mở Terminal tại thư mục `D:\Web` và chạy:
```bash
python dev_server.py
```
Mở trình duyệt truy cập: `http://localhost:3000`

---

## Hướng dẫn Deploy lên Vercel
### Cách 1: Qua GitHub (Khuyên dùng)
1. Tạo một repository mới trên GitHub (ví dụ: `safecheck-scan`).
2. Đẩy code lên GitHub:
   ```bash
   git add .
   git commit -m "Add ETH and Base chain support"
   git remote add origin https://github.com/phongvr/<tên-repo>.git
   git branch -M main
   git push -u origin main
   ```
3. Trên dashboard Vercel, chọn **Add New Project** -> import repository vừa tạo và bấm **Deploy**.

### Cách 2: Qua Vercel CLI
Nếu đã cài Vercel CLI:
```bash
npx vercel --prod
```
