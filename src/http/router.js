import {NotFoundError} from '../core/errors.js'

export class Router {
    constructor() {
        this.routes = []
    }

    add(method, path, handler) {
        this.routes.push({
            method: method,
            path: path,
            handler: handler
        })
    }


    get(path, handler) {
        this.add('GET', path, handler)
    }


    post(path, handler) {
        this.add('POST', path, handler)
    }


    match(method , path){
        for (const route of this.routes){
            if (route.method === method.toUpperCase() && route.path === path){
                return route.handler
            }
        }

        throw new NotFoundError(`Route not found: ${method} ${path}`)
    }
}