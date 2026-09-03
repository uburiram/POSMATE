// src/shared/imageResize.js
// ลดขนาดรูปก่อน Upload (ข้อ 41) — resize ฝั่ง client ด้วย Canvas
// ก่อนส่งขึ้น Firebase Storage เพื่อประหยัด bandwidth บนเน็ตมือถือที่ไม่เสถียร

const MAX_DIMENSION = 1000; // px
const JPEG_QUALITY = 0.8;

export function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("ไฟล์ที่เลือกไม่ใช่รูปภาพ"));
      return;
    }
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > MAX_DIMENSION) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else if (height > MAX_DIMENSION) {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("ไม่สามารถแปลงรูปภาพได้"));
              return;
            }
            resolve(blob);
          },
          "image/jpeg",
          JPEG_QUALITY
        );
      };
      img.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพได้"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์ได้"));
    reader.readAsDataURL(file);
  });
}
