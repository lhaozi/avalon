var disposeVirtual = require("../strategy/disposeVirtual")
var createVirtual = require("../strategy/createVirtual")
var batchUpdateEntity = require("../strategy/batchUpdateEntity")
var getBindingValue = require("./var/getBindingValue")
var quoteExpr = require("../parser/parser").quoteExpr
var scanNodes = require("../scan/scanNodes")
var msie = require("../base/builtin").msie
var addHooks = require("../vdom/hooks").addHooks
var addHook = require("../vdom/hooks").addHook

var rnoscripts = /<noscript.*?>(?:[\s\S]+?)<\/noscript>/img
var rnoscriptText = /<noscript.*?>([\s\S]+?)<\/noscript>/im

var getXHR = function () {
    return new (window.XMLHttpRequest || ActiveXObject)("Microsoft.XMLHTTP") // jshint ignore:line
}
//将所有远程加载的模板,以字符串形式存放到这里
var templatePool = avalon.templateCache = {}

avalon.directive("include", {
    init: function (binding) {
        var elem = binding.element
        var vmodel = binding.vmodel
        var loaded = getBindingValue(elem, "data-include-loaded", vmodel)
        binding.loaded = typeof loaded === "function" ? loaded : avalon.noop
        var rendered = getBindingValue(elem, "data-include-rendered", vmodel)
        binding.rendered = typeof rendered === "function" ? rendered : avalon.noop

        binding.expr = quoteExpr(binding.expr.trim())
        disposeVirtual(elem.children)
    },
    change: function (id, binding) {
        var vnode = binding.element
        if (!vnode || vnode.disposed)
            return
        addHooks(this, binding)
        if (binding.param === "src") {
            if (typeof templatePool[id] === "string") {
                scanTemplate(binding, templatePool[id], id)
            } else if (Array.isArray(templatePool[id])) { //#805 防止在循环绑定中发出许多相同的请求
                templatePool[id].push(binding)
            } else {
                var xhr = getXHR()
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        var s = xhr.status
                        if (s >= 200 && s < 300 || s === 304 || s === 1223) {
                            var text = xhr.responseText
                            var arr = templatePool[id]
                            templatePool[id] = text
                            for (var f = 0, data; data = arr[f++]; ) {
                                scanTemplate(data, text, id)
                            }

                        } else {
                            log("ms-include load [" + id + "] error")
                        }
                    }
                }
                templatePool[id] = [binding]
                xhr.open("GET", id, true)
                if ("withCredentials" in xhr) {
                    xhr.withCredentials = true
                }
                xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest")
                xhr.send(null)
            }
        } else {
            var node = document.getElementById(id)

            //IE系列与够新的标准浏览器支持通过ID取得元素（firefox14+）
            //http://tjvantoll.com/2012/07/19/dom-element-references-as-global-variables/
            if (node) {
                var text = node.tagName === "TEXTAREA" ? node.value :
                        node.tagName === "SCRIPT" ? node.text :
                        node.tagName === "NOSCRIPT" ? getNoscriptText(node) :
                        node.innerHTML
                scanTemplate(binding, text.trim(), "id:" + id)
            }
        }

    },
    update: function (node) {
        var first = node.firstChild
        if (node.childNodes.length !== 1 ||
                first.nodeType !== 1 ||
                !first.getAttribute("data-include-id")) {
            avalon.clearHTML(node)
        }
    }
})


function scanTemplate(binding, template, id) {
    template = template.trim()
    var cache = binding.cache || (binding.cache = {})
    if (!cache[id]) {
        var nodes = createVirtual(template), throwError
        if (nodes.length !== 1) {
            throwError = true
        } else {
            scanNodes(nodes, binding.vmodel)
            if (nodes.length !== 1 || nodes[0].type.charAt(0) === "#") {
                throwError = true
            }
        }
        if (throwError) {
            throw "ms-include加载的内容必须用一个元素包元素"
        }
        binding.cache[id] = nodes[0]
        nodes[0].props["data-include-id"] = id
    }
    var vnode = binding.element
    vnode.children.pop()
    vnode.children.push(binding.cache[id])
    addHook(vnode, function (elem) {
        binding.loaded(elem)
    }, "change", 1051)
    addHook(vnode, updateTemplate, "change", 1052)
    addHook(vnode, function (elem) {
        binding.rendered(elem)
    }, "afterChange", 1053)
    try {
         batchUpdateEntity(binding.vmodel.$id)
    } catch (e) {
    }
}

function updateTemplate(elem, vnode) {
    if (vnode.disposed) {
        return
    }
    var vdom = vnode.children[0]
    var id = vdom.props["data-include-id"]
    var cache = elem.cache || (elem.cache = {})
    if (!cache[id]) {
        cache[id] = vdom.toDOM()
    }
    var target = elem.firstChild
    if (!target || target.nodeType !== 1) {
        avalon.clearHTML(target)
        elem.appendChild(cache[id])
    } else if (target.getAttribute("data-include-id") !== id) {
        elem.replaceChild(cache[id], target)
    }
}

function getNoscriptText(el) {
    //IE9-11与chrome的innerHTML会得到转义的内容，它们的innerText可以
    if (el.textContent && /\S+/.test(el.textContent)) {
        return el.textContent
    }
    //IE7-8 innerText,innerHTML都无法取得其内容，IE6能取得其innerHTML
    if (msie === 6 || msie > 8 || window.netscape) {
        return el.innerHTML
    }
    //IE7,IE8需要用AJAX请求得到当前页面进行抽取
    var xhr = getXHR()
    xhr.open("GET", location, false)
    xhr.send(null)
    //http://bbs.csdn.net/topics/390349046?page=1#post-393492653
    var noscripts = document.getElementsByTagName("noscript")
    var array = (xhr.responseText || "").match(rnoscripts) || []
    var n = array.length
    for (var i = 0; i < n; i++) {
        var tag = noscripts[i]
        if (tag) {
            //IE6-8中noscript标签的innerHTML,innerText是只读的
            //http://haslayout.net/css/noscript-Ghost-Bug
            tag.style.display = "none"
            tag.textContext = (array[i].match(rnoscriptText) || ["", "&nbsp;"])[1]
        }
    }
    return el.textContent
}