package edu.ncst.campus.common;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log=LoggerFactory.getLogger(ApiExceptionHandler.class);
    private ResponseEntity<ApiError> error(HttpStatus status,String code,String message,HttpServletRequest request){
        return ResponseEntity.status(status).body(new ApiError(Instant.now(),status.value(),code,message,request.getRequestURI()));
    }
    @ExceptionHandler({IllegalArgumentException.class,MethodArgumentNotValidException.class})
    ResponseEntity<ApiError> badRequest(Exception ex,HttpServletRequest request){
        return error(HttpStatus.BAD_REQUEST,"BAD_REQUEST",ex.getMessage(),request);
    }
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiError> notFound(ResponseStatusException ex,HttpServletRequest request){
        return error(HttpStatus.NOT_FOUND,"NOT_FOUND","Feature not found",request);
    }
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ApiError> database(DataAccessException ex,HttpServletRequest request){
        log.error("Database query failure at {}",request.getRequestURI(),ex);
        return error(HttpStatus.SERVICE_UNAVAILABLE,"DATABASE_UNAVAILABLE","Database query unavailable",request);
    }
}
