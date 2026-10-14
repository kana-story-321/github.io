// お店ごとに書き換える設定ファイル。
// ここだけ編集すれば、占い・キャラ・質問の選択肢・投稿先が変わります。
window.SHOP_CONFIG = {
  shopName: "〇〇菓子店",

  // Googleの口コミ投稿ページ。Googleビジネスプロフィールの「クチコミを依頼」から取得したURLに置き換えます。
  // 例: https://g.page/r/XXXXXXXX/review
  gbpReviewUrl: "https://www.google.com/maps",

  // AI中継サーバー（worker/ をデプロイしたURL）。空のままなら、AIなしの質問・文章作成で動きます。
  // 例: https://kuchikomi-ai.example.workers.dev
  aiEndpoint: "",

  // アンケート結果の送り先（Googleスプレッドシート用のApps Script URL など）。空なら送信しません。
  feedbackEndpoint: "",

  // 商品 = 占いキャラ。rarity: N / R / SR / SSR（出やすさ）
  // textures / flavors は、その商品を食べた人に出す選択肢です。
  products: [
    {
      id: "madeleine", name: "マドレーヌ", chara: "マドちゃん", emoji: "🐚", color: "#f2c46d", rarity: "N",
      keyword: "しっとり",
      textures: ["しっとり", "ふんわり", "食べごたえ十分", "表面はさくっ"],
      flavors: ["バターの香り", "はちみつのやさしい甘さ", "レモンの爽やかさ", "焼き色の香ばしさ"],
      fortune: "やさしい言葉が、思わぬ幸運を呼ぶ日。誰かに「ありがとう」を一回多く。",
    },
    {
      id: "financier", name: "フィナンシェ", chara: "フィナン", emoji: "🧈", color: "#e0a94f", rarity: "N",
      keyword: "香ばしさ",
      textures: ["外はカリッ", "中はしっとり", "ぎゅっと詰まった食感", "軽い口どけ"],
      flavors: ["焦がしバターの香り", "アーモンドのコク", "甘さひかえめ", "上品な甘さ"],
      fortune: "コツコツ続けてきたことが、金色に光りはじめる日。小さなご褒美を自分に。",
    },
    {
      id: "cookie", name: "クッキー缶", chara: "クッキー兄弟", emoji: "🍪", color: "#c98b4b", rarity: "N",
      keyword: "さくさく",
      textures: ["さくさく", "ほろほろ", "ざくざく", "かため・噛みごたえ"],
      flavors: ["しっかりした素材の味", "種類ごとに違う味", "アクセントの塩気", "かわいい見た目"],
      fortune: "にぎやかな場所に運が集まる日。久しぶりの人に連絡してみて。",
    },
    {
      id: "canele", name: "カヌレ", chara: "カヌレ伯爵", emoji: "🔔", color: "#8a4b2a", rarity: "R",
      keyword: "外はカリッ、中はもっちり",
      textures: ["外はカリッ", "中はもっちり", "とろっとした中心", "しっかりした焼き"],
      flavors: ["ラム酒の香り", "バニラの香り", "カラメルのほろ苦さ", "甘さひかえめ"],
      fortune: "外は強く、内はやわらかく。自分のペースを守ると、まわりもついてくる日。",
    },
    {
      id: "pudding", name: "なめらかプリン", chara: "プリン姫", emoji: "🍮", color: "#f5d36b", rarity: "R",
      keyword: "なめらか",
      textures: ["とろとろ", "なめらか", "昔ながらのかため", "ぷるぷる"],
      flavors: ["卵のコク", "カラメルのほろ苦さ", "バニラの香り", "甘さひかえめ"],
      fortune: "ゆったり構えるほど、物事がするすると進む日。深呼吸をひとつ。",
    },
    {
      id: "gateau", name: "ガトーショコラ", chara: "ショコラ執事", emoji: "🍫", color: "#5a3424", rarity: "SR",
      keyword: "濃厚",
      textures: ["しっとり濃厚", "ふわっと軽め", "ねっとり", "口どけがいい"],
      flavors: ["カカオの苦み", "チョコの濃さ", "洋酒の香り", "甘さひかえめ"],
      fortune: "大人の選択が冴える日。迷ったら、ちょっと上質なほうを選んで正解。",
    },
    {
      id: "shortcake", name: "いちごのショートケーキ", chara: "ショートさん", emoji: "🍓", color: "#ef8a9a", rarity: "SR",
      keyword: "ふわふわ",
      textures: ["スポンジがふわふわ", "クリームが軽い", "しっとりスポンジ", "ボリューム満点"],
      flavors: ["いちごの甘酸っぱさ", "ミルキーなクリーム", "甘さひかえめ", "華やかな見た目"],
      fortune: "主役になれる日。お祝いごとや、新しいことのスタートに追い風。",
    },
    {
      id: "seasonal", name: "季節のタルト", chara: "旬の妖精タルトン", emoji: "🥧", color: "#9bc46d", rarity: "SSR",
      keyword: "旬の味",
      textures: ["タルト生地がさくっ", "クリームがなめらか", "果物がみずみずしい", "ずっしり満足"],
      flavors: ["旬の果物の香り", "甘酸っぱさ", "アーモンドクリームのコク", "華やかな見た目"],
      fortune: "めったに出会えない幸運の日！季節の変わり目のチャンスを逃さないで。",
    },
  ],

  // 占いの運勢ランク
  luckRanks: ["大吉", "中吉", "小吉", "吉", "末吉"],
  luckyItems: ["紅茶", "ブラックコーヒー", "ハンカチ", "黄色い小物", "手書きのメモ", "花", "お気に入りのマグ", "散歩"],
};
