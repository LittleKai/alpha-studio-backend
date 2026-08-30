/**
 * Bộ case study mẫu cho Thư viện tri thức sự kiện.
 *
 *   node scripts/seed-event-library-cases.mjs           # dry-run
 *   node scripts/seed-event-library-cases.mjs --apply   # ghi vào DB
 *   node scripts/seed-event-library-cases.mjs clean     # xoá đúng 6 mục này
 *
 * ⚠️ SỐ LIỆU LÀ MINH HOẠ, KHÁCH HÀNG ẨN DANH.
 * Không gắn kết quả chiến dịch bịa cho thương hiệu có thật — đó là tạo hồ sơ
 * giả về một công ty đang tồn tại. Ở đây khách hàng được mô tả theo ngành
 * ("nhãn bánh kẹo nội địa"), đúng cách agency viết case study blinded, và
 * `sourceName` nói rõ số liệu là minh hoạ. Khi thay bằng dữ liệu dự án thật,
 * nhớ đổi `verification` sang 'verified' và cập nhật `sourceName`.
 *
 * Mỗi case liên kết sang các skill tương ứng qua khối `linkedItems` — đúng ý
 * "Skill, Prompt & Workflow ứng dụng" trong bản thiết kế. Chạy
 * `seed-event-library-skills.mjs` trước để các liên kết đó trỏ tới mục có thật.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import EventLibraryItem from '../server/models/EventLibraryItem.js';

// Slug của bộ skill — phải khớp seed-event-library-skills.mjs
const SKILL = {
    booth: 'skill-thiet-ke-booth-va-luong-di-chuyen',
    stage: 'skill-kich-ban-san-khau-va-dieu-phoi-cue',
    activation: 'skill-thiet-ke-co-che-activation',
    roadshow: 'skill-lap-tuyen-va-van-hanh-roadshow',
    budget: 'skill-boc-tach-ngan-sach-va-boq-su-kien',
    livestream: 'skill-san-xuat-livestream-va-su-kien-hybrid'
};

const SLUGS = {
    midAutumn: 'case-mall-activation-mua-trung-thu-nganh-banh-keo',
    ev: 'case-roadshow-ra-mat-xe-dien-do-thi',
    b2bBooth: 'case-booth-trien-lam-cong-nghe-b2b',
    finance: 'case-hoi-nghi-khach-hang-thuong-nien-nganh-tai-chinh',
    saas: 'case-su-kien-hybrid-ra-mat-san-pham-saas',
    beauty: 'case-chuoi-sampling-nganh-lam-dep-tai-he-thong-ban-le'
};

/**
 * Ảnh bìa sinh bằng skill `delegate --type=image` của hybrid-ai-skills (Gemini image
 * qua Antigravity) rồi đẩy lên Cloudinary folder `event-library` bằng unsigned preset.
 * Master + bảng prompt: deliverables/event-library-covers/
 */
const COVER = {
    midAutumn: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067594/event-library/djuqkonqmbp8jazynjdp.jpg',
    ev: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067597/event-library/ztsaclibplpomlv92wv0.jpg',
    b2bBooth: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067600/event-library/ap35lkqxctzrw5gqt2ri.jpg',
    finance: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067602/event-library/yr83ayliwfds5cgzi1qu.jpg',
    saas: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067604/event-library/qmehxvc20udbznnfpfv5.jpg',
    beauty: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067607/event-library/vuis0omok417wvdcdveb.jpg',
};
const base = {
    itemType: 'case_study',
    ownership: 'platform',
    visibility: 'public',
    owner: null,
    // Chưa qua rà soát dữ liệu — xem ghi chú đầu file
    verification: 'unverified',
    sourceName: 'Alpha Studio — Case mẫu, khách hàng ẩn danh, số liệu minh hoạ',
    authorName: 'Alpha Studio',
    origin: { kind: 'manual', refId: null },
    stats: { views: 0, uses: 0 }
};

/** Khối cảnh báo đặt đầu mọi case mẫu, để người đọc không tưởng là số liệu thật. */
const disclaimer = {
    kind: 'richText',
    title: 'Về bộ case mẫu này',
    html: '<p><strong>Khách hàng đã được ẩn danh và số liệu là minh hoạ.</strong> Case này dùng để minh hoạ cấu trúc phân tích và cách trình bày, không phải báo cáo kết quả của một chiến dịch có thật. Thay bằng dữ liệu dự án thật trước khi dùng để thuyết phục khách hàng.</p>'
};

const items = [
    {
        ...base,
        slug: SLUGS.midAutumn,
        coverImage: COVER.midAutumn,
        title: {
            vi: 'Mall Activation mùa Trung Thu — ngành bánh kẹo',
            en: 'Mid-Autumn Mall Activation — Confectionery'
        },
        summary: {
            vi: 'Chuỗi activation tại 4 trung tâm thương mại, lấy trải nghiệm gia đình làm trục thay vì phát mẫu đơn thuần.',
            en: 'A four-mall activation built around family experience rather than plain sampling.'
        },
        category: 'activation',
        industries: ['fmcg', 'retail_mall'],
        objectives: ['brand_awareness', 'sales_activation'],
        kpis: ['attendance_reach', 'engagement', 'leads_database'],
        budgetTier: '1b_5b',
        depth: 'deep',
        tags: ['case-mau', 'trung-thu', 'mall', 'activation', 'sampling'],
        metrics: [
            { label: 'Lượt tham gia', value: '12.4K' },
            { label: 'Lead thu về', value: '1.8K' },
            { label: 'Điểm triển khai', value: '4' },
            { label: 'Số ngày chạy', value: '12' }
        ],
        sections: [
            disclaimer,
            {
                kind: 'keyValue',
                title: 'Bối cảnh & Mục tiêu',
                rows: [
                    { label: 'Khách hàng', value: 'Nhãn bánh kẹo nội địa, phân phối toàn quốc (ẩn danh)' },
                    { label: 'Bối cảnh', value: 'Mùa cao điểm, nhiều nhãn cùng chạy activation tại mall trong cùng khung thời gian' },
                    { label: 'Mục tiêu chính', value: 'Tăng trải nghiệm sản phẩm trực tiếp, không chỉ dừng ở phát mẫu' },
                    { label: 'Mục tiêu phụ', value: 'Thu data khách hàng gia đình phục vụ remarketing' },
                    { label: 'Ràng buộc', value: 'Mặt bằng mall giới hạn 6×6m, không được khoan sàn' }
                ]
            },
            {
                kind: 'quote',
                title: 'Insight dẫn dắt',
                quote: 'Trung Thu không bán bánh. Nó bán một buổi tối cả nhà cùng làm gì đó với nhau.',
                quoteBy: 'Insight nền tảng của concept'
            },
            {
                kind: 'steps',
                title: 'Hành trình trải nghiệm tại điểm',
                steps: [
                    { title: 'Thu hút', desc: 'Cụm đèn lồng lớn nhìn thấy từ đầu hành lang mall' },
                    { title: 'Dừng lại', desc: 'Bàn làm lồng đèn cho trẻ, cha mẹ đứng xem cạnh bên' },
                    { title: 'Trải nghiệm', desc: 'Nếm thử trong lúc chờ con hoàn thành' },
                    { title: 'Để lại data', desc: 'Chụp ảnh gia đình, gửi ảnh qua số điện thoại' },
                    { title: 'Mua', desc: 'Quầy bán đặt ngay lối ra, không chắn lối vào' }
                ]
            },
            {
                kind: 'metrics',
                title: 'Kết quả (minh hoạ)',
                metrics: [
                    { label: 'Lượt tham gia hoạt động', value: '12.4K', note: 'Cộng dồn 4 điểm' },
                    { label: 'Lead có số điện thoại', value: '1.8K', note: '≈ 15% lượt tham gia' },
                    { label: 'Thời gian dừng trung bình', value: '9 phút', note: 'Đo bằng bấm giờ mẫu' },
                    { label: 'Tỷ lệ mua tại điểm', value: '6.2%', note: 'Trên lượt tham gia' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Bài học rút ra',
                groups: [
                    {
                        title: 'Hiệu quả',
                        items: [
                            'Hoạt động cho trẻ giữ chân được cha mẹ — nhóm thật sự ra quyết định mua',
                            'Đặt quầy bán ở lối ra thay vì lối vào giúp không tắc luồng'
                        ]
                    },
                    {
                        title: 'Chưa tối ưu',
                        items: [
                            'Khâu gửi ảnh chậm hơn dự kiến, tạo hàng chờ thứ hai không lường trước',
                            'Hai điểm cuối tuần quá tải, hai điểm ngày thường vắng — phân bổ nhân sự nên khác nhau'
                        ]
                    },
                    {
                        title: 'Lần sau nên',
                        items: [
                            'Tách quầy gửi ảnh khỏi quầy làm lồng đèn',
                            'Tăng gấp đôi nhân sự cho khung 18h–21h cuối tuần'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill áp dụng',
                links: [
                    { slug: SKILL.activation, label: 'Thiết kế cơ chế Activation' },
                    { slug: SKILL.booth, label: 'Thiết kế Booth & Luồng di chuyển' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.ev,
        coverImage: COVER.ev,
        title: {
            vi: 'Roadshow ra mắt xe điện đô thị',
            en: 'Urban EV Launch Roadshow'
        },
        summary: {
            vi: 'Tuyến roadshow 9 tỉnh cho mẫu xe điện phổ thông, trọng tâm là lái thử chứ không phải trưng bày.',
            en: 'A nine-province roadshow for a mass-market EV, built around test drives rather than static display.'
        },
        category: 'roadshow',
        industries: ['automotive'],
        objectives: ['product_launch', 'brand_awareness'],
        kpis: ['attendance_reach', 'leads_database'],
        budgetTier: '5b_20b',
        depth: 'benchmark',
        tags: ['case-mau', 'roadshow', 'automotive', 'test-drive'],
        metrics: [
            { label: 'Tỉnh thành', value: '9' },
            { label: 'Lượt lái thử', value: '3.1K' },
            { label: 'Lead đủ điều kiện', value: '940' },
            { label: 'Số ngày tour', value: '28' }
        ],
        sections: [
            disclaimer,
            {
                kind: 'keyValue',
                title: 'Bối cảnh & Mục tiêu',
                rows: [
                    { label: 'Khách hàng', value: 'Hãng xe điện phổ thông, sản phẩm mới ra mắt (ẩn danh)' },
                    { label: 'Bối cảnh', value: 'Nhóm mục tiêu chưa từng lái xe điện, rào cản là lo ngại quãng đường và sạc' },
                    { label: 'Mục tiêu chính', value: 'Đưa càng nhiều người ngồi sau vô-lăng càng tốt' },
                    { label: 'Mục tiêu phụ', value: 'Lọc lead đủ điều kiện chuyển cho đại lý địa phương' },
                    { label: 'Ràng buộc', value: 'Chỉ có 2 xe demo cho toàn tuyến' }
                ]
            },
            {
                kind: 'steps',
                title: 'Cấu trúc mỗi điểm dừng',
                steps: [
                    { title: 'Dựng', desc: 'Nửa ngày, kit chuẩn hoá dùng chung cho cả 9 điểm' },
                    { title: 'Đón khách', desc: 'Đăng ký lái thử theo khung giờ, không xếp hàng tự do' },
                    { title: 'Lái thử', desc: 'Vòng cố định 8 phút, có tư vấn ngồi cùng' },
                    { title: 'Tư vấn', desc: 'Ngay sau khi xuống xe, lúc ấn tượng còn nguyên' },
                    { title: 'Bàn giao lead', desc: 'Chuyển đại lý địa phương trong 24 giờ' }
                ]
            },
            {
                kind: 'metrics',
                title: 'Kết quả (minh hoạ)',
                metrics: [
                    { label: 'Lượt lái thử', value: '3.1K', note: 'Trung bình 344 lượt/điểm' },
                    { label: 'Lead đủ điều kiện', value: '940', note: '≈ 30% lượt lái thử' },
                    { label: 'Thời gian chờ trung bình', value: '14 phút', note: 'Sau khi chuyển sang đăng ký theo khung giờ' },
                    { label: 'Điểm phải dời lịch', value: '1', note: 'Mưa lớn, dùng ngày đệm đã chừa sẵn' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Bài học rút ra',
                groups: [
                    {
                        title: 'Hiệu quả',
                        items: [
                            'Đăng ký theo khung giờ giảm hẳn hàng chờ so với hai điểm đầu chạy tự do',
                            'Ngày đệm sau mỗi ba điểm cứu được cả tuyến khi gặp mưa'
                        ]
                    },
                    {
                        title: 'Chưa tối ưu',
                        items: [
                            'Hai xe demo là quá ít cho các điểm đông — trở thành nút thắt',
                            'Chất lượng lead chênh lệch lớn giữa các đại lý do quy trình bàn giao khác nhau'
                        ]
                    },
                    {
                        title: 'Lần sau nên',
                        items: [
                            'Bổ sung xe demo thứ ba cho cụm điểm đông nhất',
                            'Chuẩn hoá biểu mẫu bàn giao lead trước khi tour khởi hành'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill áp dụng',
                links: [
                    { slug: SKILL.roadshow, label: 'Lập tuyến & Vận hành Roadshow' },
                    { slug: SKILL.budget, label: 'Bóc tách Ngân sách & BOQ' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.b2bBooth,
        coverImage: COVER.b2bBooth,
        title: {
            vi: 'Booth triển lãm công nghệ B2B',
            en: 'B2B Tech Expo Booth'
        },
        summary: {
            vi: 'Booth 54m² tại triển lãm ngành, mục tiêu là số cuộc hẹn chất lượng chứ không phải số danh thiếp.',
            en: 'A 54m² booth at an industry expo, optimised for qualified meetings rather than business-card count.'
        },
        category: 'booth_exhibition',
        industries: ['technology'],
        objectives: ['brand_awareness', 'sales_activation'],
        kpis: ['leads_database', 'sales_conversion'],
        budgetTier: '200m_1b',
        depth: 'deep',
        tags: ['case-mau', 'booth', 'b2b', 'expo'],
        metrics: [
            { label: 'Diện tích', value: '54m²' },
            { label: 'Cuộc hẹn đặt được', value: '86' },
            { label: 'Demo đã chạy', value: '210' },
            { label: 'Số ngày', value: '3' }
        ],
        sections: [
            disclaimer,
            {
                kind: 'keyValue',
                title: 'Bối cảnh & Mục tiêu',
                rows: [
                    { label: 'Khách hàng', value: 'Công ty phần mềm B2B, bán theo hợp đồng năm (ẩn danh)' },
                    { label: 'Bối cảnh', value: 'Triển lãm ngành 3 ngày, hơn 120 gian, khách đi rất nhanh' },
                    { label: 'Mục tiêu chính', value: 'Đặt được cuộc hẹn sâu sau triển lãm, không đo bằng số danh thiếp' },
                    { label: 'Ràng buộc', value: 'Booth ở dãy trong, không có mặt tiền hướng lối chính' }
                ]
            },
            {
                kind: 'keyValue',
                title: 'Cấu trúc booth',
                rows: [
                    { label: 'Vùng thu hút', value: 'Màn hình lớn chạy demo tự động, đặt ở mặt nhìn thấy từ xa nhất' },
                    { label: 'Vùng demo', value: '3 trạm demo, mỗi trạm một bài toán nghiệp vụ khác nhau' },
                    { label: 'Vùng trò chuyện', value: 'Bàn cao, ghế đẩu — đủ tiện để nói 10 phút, không tiện để ngồi 40 phút' },
                    { label: 'Vùng vận hành', value: 'Kho, chỗ sạc, chỗ để đồ nhân sự, khuất khỏi tầm khách' }
                ]
            },
            {
                kind: 'metrics',
                title: 'Kết quả (minh hoạ)',
                metrics: [
                    { label: 'Demo đã chạy', value: '210', note: '70 lượt/ngày' },
                    { label: 'Cuộc hẹn đặt được', value: '86', note: '≈ 41% số demo' },
                    { label: 'Thời gian demo trung bình', value: '7 phút', note: 'Mục tiêu đặt ra là dưới 8 phút' },
                    { label: 'Hẹn diễn ra thật', value: '61', note: 'Trong 4 tuần sau triển lãm' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Bài học rút ra',
                groups: [
                    {
                        title: 'Hiệu quả',
                        items: [
                            'Chia demo theo bài toán nghiệp vụ giúp lọc đúng người ngay từ câu hỏi đầu',
                            'Bàn cao ghế đẩu giữ cuộc trò chuyện ngắn và nhiều lượt hơn'
                        ]
                    },
                    {
                        title: 'Chưa tối ưu',
                        items: [
                            'Vị trí dãy trong khiến ngày đầu vắng — chỉ cải thiện sau khi tăng biển chỉ dẫn',
                            'Không chuẩn bị sẵn lịch trống của đội sales nên nhiều hẹn phải chốt lại sau'
                        ]
                    },
                    {
                        title: 'Lần sau nên',
                        items: [
                            'Đặt lịch đội sales vào hệ thống trước ngày khai mạc',
                            'Đàm phán vị trí gian sớm hơn, hoặc tính thêm ngân sách biển chỉ dẫn'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill áp dụng',
                links: [
                    { slug: SKILL.booth, label: 'Thiết kế Booth & Luồng di chuyển' },
                    { slug: SKILL.budget, label: 'Bóc tách Ngân sách & BOQ' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.finance,
        coverImage: COVER.finance,
        title: {
            vi: 'Hội nghị khách hàng thường niên — ngành tài chính',
            en: 'Annual Client Conference — Financial Services'
        },
        summary: {
            vi: 'Hội nghị 600 khách với kịch bản sân khấu chặt, ưu tiên đúng giờ và chuyển cảnh mượt hơn là hiệu ứng.',
            en: 'A 600-guest conference run on a tight cue sheet, prioritising punctuality and clean transitions over spectacle.'
        },
        category: 'stage_production',
        industries: ['finance'],
        objectives: ['customer_loyalty', 'internal_corporate'],
        kpis: ['attendance_reach', 'brand_recall'],
        budgetTier: '1b_5b',
        depth: 'basic',
        tags: ['case-mau', 'hoi-nghi', 'san-khau', 'finance'],
        metrics: [
            { label: 'Khách tham dự', value: '600' },
            { label: 'Cue đã chạy', value: '74' },
            { label: 'Lệch lịch', value: '4 phút' },
            { label: 'Thời lượng', value: '3.5 giờ' }
        ],
        sections: [
            disclaimer,
            {
                kind: 'keyValue',
                title: 'Bối cảnh & Mục tiêu',
                rows: [
                    { label: 'Khách hàng', value: 'Định chế tài chính, tổ chức hội nghị khách hàng hằng năm (ẩn danh)' },
                    { label: 'Bối cảnh', value: 'Khách mời là nhóm bận, lịch kín — trễ giờ là mất người' },
                    { label: 'Mục tiêu chính', value: 'Chương trình chạy đúng giờ, chuyển cảnh không lộ' },
                    { label: 'Ràng buộc', value: '9 diễn giả, trong đó 3 người chỉ có mặt đúng khung giờ của mình' }
                ]
            },
            {
                kind: 'metrics',
                title: 'Kết quả (minh hoạ)',
                metrics: [
                    { label: 'Khách tham dự', value: '600', note: '92% số đã xác nhận' },
                    { label: 'Cue đã chạy', value: '74', note: 'Không có cue nào hỏng' },
                    { label: 'Lệch so với lịch', value: '4 phút', note: 'Tính tại thời điểm kết thúc' },
                    { label: 'Ở lại tới cuối', value: '78%', note: 'Đếm tại thời điểm phát biểu bế mạc' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Bài học rút ra',
                groups: [
                    {
                        title: 'Hiệu quả',
                        items: [
                            'Bảng cue in ra phát cho từng bộ phận — không ai phải mở điện thoại giữa chương trình',
                            'Một người duy nhất gọi cue, mọi bộ phận chỉ nghe một giọng'
                        ]
                    },
                    {
                        title: 'Chưa tối ưu',
                        items: [
                            'Slide của hai diễn giả gửi muộn, phải chèn cue vào sát giờ tổng duyệt',
                            'Phần hỏi đáp không có cue riêng nên kéo dài hơn dự kiến'
                        ]
                    },
                    {
                        title: 'Lần sau nên',
                        items: [
                            'Đặt hạn chót nhận slide sớm hơn 48 giờ và có chế tài rõ ràng',
                            'Cấp cue riêng cho phần hỏi đáp, kèm tín hiệu nhắc MC kết thúc'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill áp dụng',
                links: [
                    { slug: SKILL.stage, label: 'Kịch bản sân khấu & Điều phối cue' },
                    { slug: SKILL.livestream, label: 'Sản xuất Livestream & Sự kiện hybrid' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.saas,
        coverImage: COVER.saas,
        title: {
            vi: 'Sự kiện hybrid ra mắt sản phẩm SaaS',
            en: 'Hybrid SaaS Product Launch'
        },
        summary: {
            vi: '150 khách tại chỗ và hơn 2.000 người xem online, dựng như hai chương trình song song dùng chung nội dung.',
            en: '150 in the room and 2,000+ online, produced as two parallel shows sharing one set of content.'
        },
        category: 'digital_event',
        industries: ['technology'],
        objectives: ['product_launch', 'brand_awareness'],
        kpis: ['attendance_reach', 'engagement', 'leads_database'],
        budgetTier: '200m_1b',
        depth: 'deep',
        tags: ['case-mau', 'hybrid', 'livestream', 'saas', 'product-launch'],
        metrics: [
            { label: 'Khách tại chỗ', value: '150' },
            { label: 'Xem trực tiếp', value: '2.1K' },
            { label: 'Xem lại', value: '5.4K' },
            { label: 'Thời lượng', value: '75 phút' }
        ],
        sections: [
            disclaimer,
            {
                kind: 'keyValue',
                title: 'Bối cảnh & Mục tiêu',
                rows: [
                    { label: 'Khách hàng', value: 'Công ty SaaS, ra mắt phiên bản lớn (ẩn danh)' },
                    { label: 'Bối cảnh', value: 'Người dùng phân tán nhiều nơi, phần lớn không đến trực tiếp được' },
                    { label: 'Mục tiêu chính', value: 'Khán giả online phải có trải nghiệm riêng, không phải xem ké' },
                    { label: 'Ràng buộc', value: 'Ngân sách chỉ đủ cho 3 camera và một đường truyền dự phòng' }
                ]
            },
            {
                kind: 'steps',
                title: 'Cấu trúc sản xuất',
                steps: [
                    { title: 'Chốt kênh phát', desc: 'Một kênh chính, một kênh dự phòng riêng tư' },
                    { title: 'Sơ đồ tín hiệu', desc: 'Vẽ rõ từng sợi từ mixer đến máy encode' },
                    { title: 'Test stream thật', desc: 'Phát thử lên kênh riêng tư đủ 20 phút' },
                    { title: 'Tổng duyệt hai chiều', desc: 'Kiểm tra cả trong phòng lẫn trên màn hình người xem' },
                    { title: 'Trực chat', desc: 'Một người chuyên trách, có kịch bản trả lời sẵn' }
                ]
            },
            {
                kind: 'metrics',
                title: 'Kết quả (minh hoạ)',
                metrics: [
                    { label: 'Xem trực tiếp (đỉnh)', value: '2.1K', note: 'Tại phút thứ 22, lúc demo sản phẩm' },
                    { label: 'Thời gian xem trung bình', value: '31 phút', note: 'Trên tổng 75 phút' },
                    { label: 'Câu hỏi từ chat', value: '180', note: '12 câu được trả lời trực tiếp' },
                    { label: 'Đăng ký dùng thử', value: '640', note: 'Trong 72 giờ sau sự kiện' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Bài học rút ra',
                groups: [
                    {
                        title: 'Hiệu quả',
                        items: [
                            'Có người trực chat chuyên trách khiến khán giả online thấy được lắng nghe',
                            'Ghi hình cục bộ song song cứu được phần đầu khi bản trên nền tảng lỗi'
                        ]
                    },
                    {
                        title: 'Chưa tối ưu',
                        items: [
                            'Slide thiết kế cho màn lớn, đọc trên điện thoại bị nhỏ',
                            'Camera vị trí giữa phòng che tầm nhìn hai hàng ghế'
                        ]
                    },
                    {
                        title: 'Lần sau nên',
                        items: [
                            'Làm riêng bản slide cho stream với cỡ chữ lớn hơn',
                            'Đưa camera lên bục cao hoặc ra sát tường bên'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill áp dụng',
                links: [
                    { slug: SKILL.livestream, label: 'Sản xuất Livestream & Sự kiện hybrid' },
                    { slug: SKILL.stage, label: 'Kịch bản sân khấu & Điều phối cue' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.beauty,
        coverImage: COVER.beauty,
        title: {
            vi: 'Chuỗi sampling ngành làm đẹp tại hệ thống bán lẻ',
            en: 'Beauty Sampling Programme in Retail Chain'
        },
        summary: {
            vi: '18 điểm bán trong 6 tuần, đổi từ phát mẫu đại trà sang tư vấn ngắn có sản phẩm dùng thử.',
            en: 'Eighteen stores over six weeks, shifting from mass sampling to short consultations with a trial product.'
        },
        category: 'activation',
        industries: ['beauty', 'retail_mall'],
        objectives: ['sales_activation', 'customer_loyalty'],
        kpis: ['engagement', 'sales_conversion'],
        budgetTier: 'under_200m',
        depth: 'basic',
        tags: ['case-mau', 'sampling', 'beauty', 'retail'],
        metrics: [
            { label: 'Điểm bán', value: '18' },
            { label: 'Lượt tư vấn', value: '4.6K' },
            { label: 'Tỷ lệ mua', value: '11%' },
            { label: 'Số tuần', value: '6' }
        ],
        sections: [
            disclaimer,
            {
                kind: 'keyValue',
                title: 'Bối cảnh & Mục tiêu',
                rows: [
                    { label: 'Khách hàng', value: 'Nhãn chăm sóc da tầm trung, phân phối qua chuỗi bán lẻ (ẩn danh)' },
                    { label: 'Bối cảnh', value: 'Phát mẫu đại trà ở đợt trước tốn nhiều mẫu nhưng ít chuyển đổi' },
                    { label: 'Thay đổi cách làm', value: 'Ít mẫu hơn, mỗi mẫu đi kèm một cuộc tư vấn 2 phút' },
                    { label: 'Ràng buộc', value: 'Chỉ được đứng ở khu vực quy định của chuỗi, không di chuyển tự do' }
                ]
            },
            {
                kind: 'metrics',
                title: 'Kết quả (minh hoạ)',
                metrics: [
                    { label: 'Lượt tư vấn', value: '4.6K', note: '≈ 256 lượt/điểm' },
                    { label: 'Mẫu đã phát', value: '4.6K', note: 'Bằng đúng số lượt tư vấn, không phát rời' },
                    { label: 'Tỷ lệ mua tại điểm', value: '11%', note: 'Đợt trước phát đại trà: 3%' },
                    { label: 'Chi phí mỗi lượt mua', value: 'Giảm ~60%', note: 'So với đợt phát đại trà' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Bài học rút ra',
                groups: [
                    {
                        title: 'Hiệu quả',
                        items: [
                            'Gắn mẫu với một cuộc trò chuyện làm tăng mạnh tỷ lệ mua so với phát rời',
                            'Ít mẫu hơn nhưng đúng người thì rẻ hơn nhiều trên mỗi đơn'
                        ]
                    },
                    {
                        title: 'Chưa tối ưu',
                        items: [
                            'Chất lượng tư vấn phụ thuộc nhiều vào từng nhân sự',
                            'Ba điểm bán có lưu lượng quá thấp, không đủ để đánh giá'
                        ]
                    },
                    {
                        title: 'Lần sau nên',
                        items: [
                            'Đào tạo và chấm thử nhân sự trước khi ra điểm',
                            'Loại các điểm dưới ngưỡng lưu lượng ngay từ khâu chọn'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Skill áp dụng',
                links: [
                    { slug: SKILL.activation, label: 'Thiết kế cơ chế Activation' }
                ]
            }
        ]
    }
];

// ─── Chạy ──────────────────────────────────────────────────────────────────

const MODE = process.argv.includes('clean') ? 'clean'
    : process.argv.includes('--apply') ? 'apply'
        : 'dry';

await mongoose.connect(process.env.MONGODB_URI);
const allSlugs = Object.values(SLUGS);

if (MODE === 'clean') {
    const result = await EventLibraryItem.deleteMany({ slug: { $in: allSlugs } });
    console.log(`Đã xoá ${result.deletedCount} case mẫu.`);
} else {
    // Cảnh báo nếu bộ skill chưa được seed — khối linkedItems sẽ trỏ vào hư không
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
