/**
 * Bộ prompt mẫu cho Thư viện tri thức sự kiện.
 *
 *   node scripts/seed-event-library-prompts.mjs           # dry-run
 *   node scripts/seed-event-library-prompts.mjs --apply   # ghi vào DB
 *   node scripts/seed-event-library-prompts.mjs clean     # xoá đúng 6 mục này
 *
 * Nội dung prompt nằm trong khối `richText` bọc thẻ <pre> để giữ nguyên xuống
 * dòng. Biến cần thay dùng dấu ngoặc vuông [NHƯ_THẾ_NÀY] — tránh dấu ngoặc nhọn
 * vì phải escape trong HTML.
 *
 * Lưu ý: thư viện chưa có nút "Sao chép prompt". Người dùng phải bôi đen và
 * copy tay. Muốn có nút copy thì cần thêm một `kind` mới (ví dụ `codeBlock`)
 * vào cả SectionEditor lẫn SectionRenderer.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import EventLibraryItem from '../server/models/EventLibraryItem.js';

const SKILL = {
    booth: 'skill-thiet-ke-booth-va-luong-di-chuyen',
    stage: 'skill-kich-ban-san-khau-va-dieu-phoi-cue',
    activation: 'skill-thiet-ke-co-che-activation',
    roadshow: 'skill-lap-tuyen-va-van-hanh-roadshow',
    budget: 'skill-boc-tach-ngan-sach-va-boq-su-kien',
    livestream: 'skill-san-xuat-livestream-va-su-kien-hybrid'
};

const SLUGS = {
    concept: 'prompt-sinh-concept-su-kien-tu-brief',
    storyboard: 'prompt-storyboard-noi-dung-man-led',
    boq: 'prompt-boc-tach-boq-tu-mo-ta-hang-muc',
    runOfShow: 'prompt-viet-kich-ban-mc-va-run-of-show',
    mechanic: 'prompt-sinh-co-che-activation-tu-insight',
    recap: 'prompt-viet-bai-recap-hau-su-kien'
};

/**
 * Ảnh bìa sinh bằng skill `delegate --type=image` của hybrid-ai-skills (Gemini image
 * qua Antigravity) rồi đẩy lên Cloudinary folder `event-library` bằng unsigned preset.
 * Master + bảng prompt: deliverables/event-library-covers/
 */
const COVER = {
    concept: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067609/event-library/nlcbujbehrjmqblhuj4w.jpg',
    storyboard: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067610/event-library/vduhcdcqlkpf8lxq4ur9.jpg',
    boq: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067612/event-library/qafr72zoakdszdtyvtmv.jpg',
    runOfShow: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067613/event-library/jba53rvg4jsphevjysro.jpg',
    mechanic: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067615/event-library/o59vzi2ibufdxep9tfxw.jpg',
    recap: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067616/event-library/qqtpvwgzrz7xnfaehq0t.jpg',
};
const base = {
    itemType: 'prompt',
    ownership: 'platform',
    visibility: 'public',
    owner: null,
    verification: 'unverified',
    sourceName: 'Alpha Studio — Biên tập nội bộ',
    authorName: 'Alpha Studio',
    origin: { kind: 'manual', refId: null },
    stats: { views: 0, uses: 0 }
};

/** Bọc nội dung prompt trong <pre> để giữ xuống dòng khi render. */
const promptBlock = (title, text) => ({
    kind: 'richText',
    title,
    html: `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;line-height:1.6">${text}</pre>`
});

const items = [
    {
        ...base,
        slug: SLUGS.concept,
        coverImage: COVER.concept,
        title: {
            vi: 'Sinh concept sự kiện từ brief',
            en: 'Generate Event Concepts from a Brief'
        },
        summary: {
            vi: 'Biến brief khách hàng thành 3 hướng concept khác nhau về bản chất, không phải 3 biến thể của cùng một ý.',
            en: 'Turn a client brief into three genuinely different concept directions, not three skins of one idea.'
        },
        category: 'event',
        industries: ['fmcg', 'technology', 'finance'],
        objectives: ['product_launch', 'brand_awareness'],
        kpis: ['brand_recall'],
        depth: 'basic',
        tags: ['prompt', 'concept', 'brief', 'ideation'],
        metrics: [
            { label: 'Biến cần thay', value: '6' },
            { label: 'Đầu ra', value: '3 concept' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Khi nào dùng',
                html: '<p>Dùng ở bước đầu, ngay sau khi nhận brief và trước khi họp nội bộ. Mục tiêu không phải là ra concept cuối, mà là <strong>mở đủ rộng để cuộc họp có gì để chọn</strong>.</p><p>Nếu ba concept trả về nghe na ná nhau, thường là do brief chưa nêu rõ ràng buộc — bổ sung ràng buộc rồi chạy lại.</p>'
            },
            promptBlock('Prompt', `Bạn là giám đốc sáng tạo của một agency sự kiện tại Việt Nam.

BRIEF
- Khách hàng / ngành hàng: [KHÁCH_HÀNG]
- Loại hình sự kiện: [LOẠI_HÌNH]
- Đối tượng tham dự: [ĐỐI_TƯỢNG]
- Mục tiêu đo được: [MỤC_TIÊU]
- Ngân sách và quy mô: [NGÂN_SÁCH_QUY_MÔ]
- Ràng buộc bắt buộc: [RÀNG_BUỘC]

YÊU CẦU
Đề xuất 3 hướng concept KHÁC NHAU VỀ BẢN CHẤT, không phải 3 biến thể của cùng một ý.
Mỗi hướng trình bày theo đúng cấu trúc:
1. Tên concept (ngắn, dễ nhớ, tiếng Việt)
2. Insight nền tảng — một câu, nói về người tham dự chứ không về thương hiệu
3. Trải nghiệm chính khách sẽ nhớ lại sau một tuần
4. Ba điểm chạm cụ thể tại hiện trường
5. Rủi ro lớn nhất khi triển khai concept này

RÀNG BUỘC
- Không dùng từ sáo rỗng: đẳng cấp, bùng nổ, đỉnh cao, thăng hoa.
- Mọi đề xuất phải nằm trong ngân sách và ràng buộc đã nêu.
- Nếu brief thiếu thông tin để quyết định, hỏi lại tối đa 3 câu trước khi đề xuất.`),
            {
                kind: 'keyValue',
                title: 'Biến cần thay',
                rows: [
                    { label: '[KHÁCH_HÀNG]', value: 'Tên hoặc mô tả ngành hàng, kèm định vị nếu có' },
                    { label: '[LOẠI_HÌNH]', value: 'Ra mắt sản phẩm, hội nghị, activation, roadshow…' },
                    { label: '[ĐỐI_TƯỢNG]', value: 'Càng cụ thể càng tốt — độ tuổi, vai trò, lý do họ đến' },
                    { label: '[MỤC_TIÊU]', value: 'Phải đo được; "tăng nhận diện" là chưa đủ' },
                    { label: '[NGÂN_SÁCH_QUY_MÔ]', value: 'Khoảng ngân sách và số khách dự kiến' },
                    { label: '[RÀNG_BUỘC]', value: 'Mặt bằng, thời gian, quy định ngành, những thứ không được làm' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Lưu ý khi dùng',
                groups: [
                    {
                        title: 'Cho kết quả tốt hơn',
                        items: [
                            'Nêu rõ ràng buộc — ràng buộc là thứ tạo ra concept khác biệt',
                            'Đưa 1–2 ví dụ sự kiện bạn thấy đúng hướng để hiệu chỉnh gu'
                        ]
                    },
                    {
                        title: 'Đừng kỳ vọng',
                        items: [
                            'Đây không phải concept cuối — luôn cần một vòng biên tập của người',
                            'Số liệu do mô hình đưa ra phải kiểm chứng lại, đừng đưa thẳng vào proposal'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill liên quan',
                links: [{ slug: SKILL.activation, label: 'Thiết kế cơ chế Activation' }]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.storyboard,
        coverImage: COVER.storyboard,
        title: {
            vi: 'Storyboard nội dung màn LED',
            en: 'LED Screen Content Storyboard'
        },
        summary: {
            vi: 'Từ kịch bản chương trình ra bảng storyboard từng cue cho màn LED, kèm mô tả hình và thời lượng.',
            en: 'Turn a run-of-show into a per-cue LED storyboard with visual notes and durations.'
        },
        category: 'stage_production',
        industries: ['technology', 'finance', 'education'],
        objectives: ['product_launch', 'internal_corporate'],
        kpis: ['engagement'],
        depth: 'basic',
        tags: ['prompt', 'led', 'storyboard', 'stage'],
        metrics: [
            { label: 'Biến cần thay', value: '4' },
            { label: 'Đầu ra', value: 'Bảng cue' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Khi nào dùng',
                html: '<p>Sau khi kịch bản chương trình đã chốt nội dung, trước khi giao cho đội motion. Đầu ra là bảng để <strong>thảo luận và giao việc</strong>, không phải file thiết kế.</p>'
            },
            promptBlock('Prompt', `Bạn là art director chuyên nội dung màn LED sân khấu.

ĐẦU VÀO
- Kịch bản chương trình: [KỊCH_BẢN]
- Kích thước và tỷ lệ màn: [TỶ_LỆ_MÀN]
- Tông thương hiệu: [TÔNG_THƯƠNG_HIỆU]
- Thời lượng tổng: [THỜI_LƯỢNG]

YÊU CẦU
Lập bảng storyboard, mỗi dòng là một cue, gồm các cột:
| Cue | Thời điểm | Nội dung sân khấu | Hình trên màn | Thời lượng | Ghi chú sản xuất |

RÀNG BUỘC
- Chữ trên màn tối thiểu 1/12 chiều cao màn hình để đọc được ở 20m.
- Chừa 15% mép an toàn, không đặt thông tin quan trọng sát biên.
- Không đề xuất hiệu ứng nhấp nháy nhanh dưới 3Hz.
- Mỗi cue ghi rõ là ảnh tĩnh, video nền hay đồ hoạ động — vì chi phí sản xuất khác nhau.
- Nếu một cue cần nội dung chưa có trong kịch bản, đánh dấu [CẦN BỔ SUNG] thay vì tự bịa.`),
            {
                kind: 'keyValue',
                title: 'Biến cần thay',
                rows: [
                    { label: '[KỊCH_BẢN]', value: 'Dán nguyên kịch bản chương trình đã chốt' },
                    { label: '[TỶ_LỆ_MÀN]', value: 'Ví dụ: 16:9, 21:9, hoặc kích thước thật tính bằng mét' },
                    { label: '[TÔNG_THƯƠNG_HIỆU]', value: 'Màu chủ đạo, font, mức độ trang trọng' },
                    { label: '[THỜI_LƯỢNG]', value: 'Tổng thời lượng chương trình' }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill liên quan',
                links: [{ slug: SKILL.stage, label: 'Kịch bản sân khấu & Điều phối cue' }]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.boq,
        coverImage: COVER.boq,
        title: {
            vi: 'Bóc tách BOQ từ mô tả hạng mục',
            en: 'Draft a BOQ from a Scope Description'
        },
        summary: {
            vi: 'Từ mô tả hạng mục bằng lời ra khung BOQ 7 nhóm, kèm danh sách hạng mục hay bị bỏ sót.',
            en: 'Turn a plain-language scope into a seven-group BOQ, with the usual forgotten line items flagged.'
        },
        category: 'event',
        industries: ['fmcg', 'technology', 'finance', 'retail_mall'],
        objectives: ['internal_corporate'],
        kpis: ['sales_conversion'],
        depth: 'deep',
        tags: ['prompt', 'boq', 'budget', 'procurement'],
        metrics: [
            { label: 'Biến cần thay', value: '4' },
            { label: 'Nhóm đầu ra', value: '7' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Khi nào dùng',
                html: '<p>Dùng để <strong>dựng khung BOQ trống</strong> phát cho nhà thầu, hoặc để rà xem báo giá nhận về có thiếu nhóm hạng mục nào không. Không dùng để ước giá — mô hình không biết giá thị trường Việt Nam tại thời điểm bạn hỏi.</p>'
            },
            promptBlock('Prompt', `Bạn là trưởng bộ phận sản xuất của một agency sự kiện.

ĐẦU VÀO
- Mô tả hạng mục: [MÔ_TẢ_HẠNG_MỤC]
- Loại hình và quy mô: [LOẠI_HÌNH_QUY_MÔ]
- Địa điểm: [ĐỊA_ĐIỂM]
- Số ngày thi công và vận hành: [SỐ_NGÀY]

YÊU CẦU
Lập khung BOQ theo đúng 7 nhóm sau, KHÔNG gộp nhóm:
1. Mặt bằng   2. Thi công   3. Thiết bị   4. Nội dung
5. Nhân sự    6. Vận hành   7. Dự phòng (dòng riêng, không giấu vào nhóm khác)

Mỗi dòng gồm: Hạng mục | Đơn vị tính | Số lượng | Ghi chú kỹ thuật
ĐỂ TRỐNG cột đơn giá và thành tiền — khung này để nhà thầu điền.

SAU BẢNG, liệt kê riêng:
(a) Hạng mục hay bị bỏ sót với loại sự kiện này
(b) Những giả định bạn đã dùng để lập khung — nếu giả định sai thì khung sai

RÀNG BUỘC
- Không tự điền đơn giá hay tổng tiền dưới bất kỳ hình thức nào.
- Nếu mô tả hạng mục quá mơ hồ để lập dòng, ghi [CẦN LÀM RÕ] kèm câu hỏi cụ thể.`),
            {
                kind: 'keyValue',
                title: 'Biến cần thay',
                rows: [
                    { label: '[MÔ_TẢ_HẠNG_MỤC]', value: 'Mô tả bằng lời những gì cần dựng và vận hành' },
                    { label: '[LOẠI_HÌNH_QUY_MÔ]', value: 'Loại sự kiện và số khách dự kiến' },
                    { label: '[ĐỊA_ĐIỂM]', value: 'Trong nhà / ngoài trời, mall / trung tâm hội nghị, tỉnh nào' },
                    { label: '[SỐ_NGÀY]', value: 'Tách riêng ngày thi công và ngày vận hành' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Lưu ý',
                groups: [
                    {
                        title: 'Nên',
                        items: [
                            'Đọc kỹ mục "giả định" ở cuối — đó là chỗ khung dễ sai nhất',
                            'Đối chiếu phần "hay bị bỏ sót" với báo giá nhà thầu gửi về'
                        ]
                    },
                    {
                        title: 'Không nên',
                        items: [
                            'Nhờ mô hình ước đơn giá rồi đưa vào proposal',
                            'Bỏ dòng dự phòng vì thấy tổng cao'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill liên quan',
                links: [{ slug: SKILL.budget, label: 'Bóc tách Ngân sách & BOQ sự kiện' }]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.runOfShow,
        coverImage: COVER.runOfShow,
        title: {
            vi: 'Viết kịch bản MC & Run-of-show',
            en: 'MC Script & Run-of-Show Writer'
        },
        summary: {
            vi: 'Từ dàn ý chương trình ra kịch bản MC theo từng phân đoạn, kèm cột thời lượng để kiểm soát tổng giờ.',
            en: 'Turn an outline into a segment-by-segment MC script with a duration column to keep total runtime honest.'
        },
        category: 'stage_production',
        industries: ['finance', 'technology', 'education'],
        objectives: ['internal_corporate', 'customer_loyalty'],
        kpis: ['brand_recall'],
        depth: 'basic',
        tags: ['prompt', 'mc', 'run-of-show', 'script'],
        metrics: [
            { label: 'Biến cần thay', value: '5' },
            { label: 'Đầu ra', value: 'Kịch bản' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Khi nào dùng',
                html: '<p>Khi dàn ý đã chốt và cần bản nháp kịch bản để MC và khách hàng cùng đọc. Bản nháp này <strong>luôn cần MC đọc lại thành tiếng</strong> — câu viết ra đọc được chưa chắc nói được.</p>'
            },
            promptBlock('Prompt', `Bạn là biên kịch chương trình sự kiện.

ĐẦU VÀO
- Dàn ý chương trình: [DÀN_Ý]
- Tính chất sự kiện: [TÍNH_CHẤT]
- Đối tượng khán giả: [KHÁN_GIẢ]
- Tổng thời lượng cho phép: [THỜI_LƯỢNG]
- Số MC và vai trò: [MC]

YÊU CẦU
Viết kịch bản theo từng phân đoạn, mỗi phân đoạn gồm:
| Phân đoạn | Thời lượng | Lời MC | Ghi chú sân khấu |

RÀNG BUỘC
- Lời MC viết như nói, không viết như đọc văn bản.
- Câu dài quá 25 từ phải tách ra.
- Tổng thời lượng các phân đoạn không vượt [THỜI_LƯỢNG]; nếu vượt, nói rõ phải cắt phân đoạn nào.
- Chừa sẵn một dòng cue cho phần hỏi đáp kèm tín hiệu nhắc MC kết thúc.
- Không viết lời tri ân sáo rỗng; nếu cần cảm ơn thì nêu lý do cụ thể.`),
            {
                kind: 'keyValue',
                title: 'Biến cần thay',
                rows: [
                    { label: '[DÀN_Ý]', value: 'Các phân đoạn theo thứ tự, kèm ai lên sân khấu' },
                    { label: '[TÍNH_CHẤT]', value: 'Trang trọng, thân mật, nội bộ, ra mắt sản phẩm…' },
                    { label: '[KHÁN_GIẢ]', value: 'Ai ngồi dưới, họ quan tâm điều gì' },
                    { label: '[THỜI_LƯỢNG]', value: 'Tổng số phút cho phép' },
                    { label: '[MC]', value: 'Một hay hai MC, vai trò từng người' }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill liên quan',
                links: [{ slug: SKILL.stage, label: 'Kịch bản sân khấu & Điều phối cue' }]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.mechanic,
        coverImage: COVER.mechanic,
        title: {
            vi: 'Sinh cơ chế Activation từ insight',
            en: 'Activation Mechanics from an Insight'
        },
        summary: {
            vi: 'Từ một insight ra 5 cơ chế tương tác, mỗi cơ chế kèm thời lượng lượt chơi và điểm dễ tắc.',
            en: 'Turn one insight into five interaction mechanics, each with per-play duration and its likely bottleneck.'
        },
        category: 'activation',
        industries: ['fmcg', 'beauty', 'fnb', 'retail_mall'],
        objectives: ['sales_activation', 'customer_loyalty'],
        kpis: ['engagement', 'leads_database'],
        depth: 'basic',
        tags: ['prompt', 'activation', 'game-mechanic', 'insight'],
        metrics: [
            { label: 'Biến cần thay', value: '5' },
            { label: 'Đầu ra', value: '5 cơ chế' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Khi nào dùng',
                html: '<p>Khi đã có insight nhưng chưa biết biến nó thành hoạt động gì tại điểm. Prompt buộc mô hình <strong>tự nêu điểm dễ tắc</strong> của từng cơ chế — đó thường là phần quyết định cơ chế nào chạy được thật.</p>'
            },
            promptBlock('Prompt', `Bạn là người thiết kế trải nghiệm activation tại điểm bán.

ĐẦU VÀO
- Insight nền tảng: [INSIGHT]
- Sản phẩm và điều muốn khách trải nghiệm: [SẢN_PHẨM]
- Nơi đặt hoạt động: [ĐỊA_ĐIỂM]
- Diện tích khả dụng: [DIỆN_TÍCH]
- Số nhân sự tại điểm: [NHÂN_SỰ]

YÊU CẦU
Đề xuất 5 cơ chế, mỗi cơ chế gồm:
1. Tên cơ chế
2. Cách chơi, giải thích được trong 5 giây
3. Thời lượng một lượt (giây)
4. Số nhân sự cần
5. Điểm dễ tắc nhất và cách xử lý
6. Cơ chế này gắn với sản phẩm ở chỗ nào

RÀNG BUỘC
- Thời gian phát quà phải NGẮN HƠN thời gian chơi, nếu không sẽ tắc.
- Loại ngay cơ chế cần giải thích quá 5 giây.
- Nếu bỏ thương hiệu ra mà trò chơi vẫn nguyên vẹn thì cơ chế đó đang rỗng — tự đánh dấu.
- Cơ chế phải vừa trong [DIỆN_TÍCH] và chạy được với [NHÂN_SỰ].`),
            {
                kind: 'keyValue',
                title: 'Biến cần thay',
                rows: [
                    { label: '[INSIGHT]', value: 'Một câu về người tham dự, không phải về thương hiệu' },
                    { label: '[SẢN_PHẨM]', value: 'Sản phẩm và điều bạn muốn khách cảm nhận được' },
                    { label: '[ĐỊA_ĐIỂM]', value: 'Mall, siêu thị, trường học, sự kiện ngoài trời…' },
                    { label: '[DIỆN_TÍCH]', value: 'Kích thước thực tế được phép dựng' },
                    { label: '[NHÂN_SỰ]', value: 'Số người trực tại điểm mỗi ca' }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill liên quan',
                links: [
                    { slug: SKILL.activation, label: 'Thiết kế cơ chế Activation' },
                    { slug: SKILL.booth, label: 'Thiết kế Booth & Luồng di chuyển' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.recap,
        coverImage: COVER.recap,
        title: {
            vi: 'Viết bài recap hậu sự kiện',
            en: 'Post-Event Recap Writer'
        },
        summary: {
            vi: 'Từ số liệu và ghi chép hiện trường ra bộ bài recap cho các kênh, không phóng đại kết quả.',
            en: 'Turn on-site notes and numbers into channel-ready recaps, without inflating the results.'
        },
        category: 'digital_event',
        industries: ['fmcg', 'technology', 'education'],
        objectives: ['brand_awareness'],
        kpis: ['engagement', 'attendance_reach'],
        depth: 'basic',
        tags: ['prompt', 'recap', 'social', 'post-event'],
        metrics: [
            { label: 'Biến cần thay', value: '5' },
            { label: 'Đầu ra', value: '4 bản' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Khi nào dùng',
                html: '<p>Trong 48 giờ sau sự kiện, khi số liệu đã có và ảnh đã chọn xong. Ràng buộc quan trọng nhất của prompt này là <strong>cấm phóng đại</strong> — recap thổi phồng là thứ khách hàng nhớ rất lâu theo nghĩa xấu.</p>'
            },
            promptBlock('Prompt', `Bạn là copywriter của một agency sự kiện.

ĐẦU VÀO
- Tên và tính chất sự kiện: [SỰ_KIỆN]
- Số liệu thực tế đã kiểm chứng: [SỐ_LIỆU]
- Khoảnh khắc đáng nhớ tại hiện trường: [KHOẢNH_KHẮC]
- Thông điệp thương hiệu cần giữ: [THÔNG_ĐIỆP]
- Kênh đăng: [KÊNH]

YÊU CẦU
Viết 4 bản:
1. Post Facebook — 120–150 từ, mở đầu bằng một khoảnh khắc cụ thể
2. Caption Instagram — dưới 60 từ, kèm 5 hashtag
3. Post LinkedIn — 150–200 từ, giọng nghiệp vụ, nêu cách làm chứ không khoe
4. Đoạn recap cho email khách hàng — 200 từ, có số liệu

RÀNG BUỘC
- CHỈ dùng số liệu trong [SỐ_LIỆU]. Tuyệt đối không suy ra hay làm tròn lên.
- Nếu thiếu số liệu cho một luận điểm, viết [THIẾU SỐ LIỆU] thay vì bịa.
- Không dùng: bùng nổ, cháy vé, đỉnh cao, thành công rực rỡ.
- Mỗi bản phải nhắc được ít nhất một chi tiết cụ thể từ [KHOẢNH_KHẮC].`),
            {
                kind: 'keyValue',
                title: 'Biến cần thay',
                rows: [
                    { label: '[SỰ_KIỆN]', value: 'Tên và loại hình sự kiện' },
                    { label: '[SỐ_LIỆU]', value: 'Chỉ đưa số đã kiểm chứng — đây là ranh giới của bài viết' },
                    { label: '[KHOẢNH_KHẮC]', value: '2–3 chi tiết thật tại hiện trường' },
                    { label: '[THÔNG_ĐIỆP]', value: 'Thông điệp thương hiệu cần giữ nguyên' },
                    { label: '[KÊNH]', value: 'Các kênh sẽ đăng, để điều chỉnh giọng' }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill liên quan',
                links: [{ slug: SKILL.livestream, label: 'Sản xuất Livestream & Sự kiện hybrid' }]
            }
        ]
    }
];

// ─── Chạy ──────────────────────────────────────────────────────────────────

const MODE = process.argv.includes('clean') ? 'clean'
    : process.argv.includes('--apply') ? 'apply'
        : 'dry';

await mongoose.connect(process.env.MONGODB_URI);

if (MODE === 'clean') {
    const result = await EventLibraryItem.deleteMany({ slug: { $in: Object.values(SLUGS) } });
    console.log(`Đã xoá ${result.deletedCount} prompt mẫu.`);
} else {
    const skillCount = await EventLibraryItem.countDocuments({ slug: { $in: Object.values(SKILL) } });
    if (skillCount < Object.keys(SKILL).length) {
        console.log(`⚠ Mới có ${skillCount}/${Object.keys(SKILL).length} skill trong DB — chạy seed-event-library-skills.mjs --apply trước để liên kết không bị gãy.`);
    }

    let created = 0;
    let skipped = 0;
    for (const item of items) {
        if (await EventLibraryItem.exists({ slug: item.slug })) {
            console.log(`  bỏ qua (đã có): ${item.slug}`);
            skipped++;
            continue;
        }
        console.log(`  ${MODE === 'apply' ? 'tạo' : 'sẽ tạo'}: ${item.slug} — ${item.sections.length} khối`);
        if (MODE === 'apply') {
            await EventLibraryItem.create(item);
            created++;
        }
    }
    console.log(MODE === 'apply'
        ? `Xong: tạo ${created}, bỏ qua ${skipped}.`
        : `Dry-run: ${items.length - skipped} mục sẽ được tạo. Chạy lại với --apply để ghi.`);
}

await mongoose.disconnect();
